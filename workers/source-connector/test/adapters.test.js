import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { openPostgresCursorStore } from '../src/postgres-cursor-store.js'
import { createKafkaPublisher } from '../src/kafka-publisher.js'

const initial = { event_feed_id: 'feed-1', after_seq: 0 }
function database({ acquired = true, row = { ...initial }, conflict = false } = {}) {
  const calls = [], client = new EventEmitter()
  client.release = destroy => calls.push(['release', destroy])
  client.query = async (sql, args) => {
    calls.push([sql, args])
    if (sql.includes('pg_try')) return { rows: [{ acquired }] }
    if (sql.startsWith('SELECT event')) return { rows: [{ ...row }] }
    if (sql.startsWith('UPDATE')) { row.after_seq = args[3]; return { rowCount: conflict ? 0 : 1 } }
    return { rowCount: 1 }
  }
  return { client, calls, open: () => openPostgresCursorStore({ pool: { connect: async () => client }, connectorId: 'medusa', initialCursor: initial }) }
}
test('cursor reads existing progress rather than resetting to bootstrap', async () => {
  const d = database({ row: { ...initial, after_seq: '103' } }), store = await d.open()
  assert.equal((await store.load()).after_seq, 103)
  store.close(); store.close()
  assert.equal(d.calls.filter(([sql]) => sql === 'release').length, 1)
})
test('second owner is rejected before cursor write', async () => {
  const d = database({ acquired: false })
  await assert.rejects(d.open(), { code: 'CONNECTOR_ALREADY_OWNED' })
  assert.equal(d.calls.some(([sql]) => sql.startsWith('INSERT')), false)
})
test('lineage mismatch is not reset', async () => {
  const d = database({ row: { event_feed_id: 'other', after_seq: 0 } })
  await assert.rejects(d.open(), { code: 'FEED_ID_MISMATCH' })
  assert.deepEqual(d.calls.at(-1), ['release', true])
})
test('cursor advances using expected sequence CAS and permits gaps', async () => {
  const d = database(), store = await d.open()
  await store.advance(initial, { ...initial, after_seq: 103 })
  assert.deepEqual(d.calls.at(-1)[1], ['medusa', 'feed-1', 0, 103])
  await assert.rejects(store.advance({ ...initial, after_seq: 103 }, initial), { code: 'INVALID_CURSOR_ADVANCE' })
  store.close()
})
test('CAS conflict poisons owner', async () => {
  const d = database({ conflict: true }), store = await d.open()
  await assert.rejects(store.advance(initial, { ...initial, after_seq: 1 }), { code: 'CURSOR_CONFLICT' })
  await assert.rejects(store.load(), { code: 'CURSOR_OWNER_LOST' }); store.close()
})
test('connection loss prevents subsequent cursor operations', async () => {
  const d = database(), store = await d.open()
  d.client.emit('error', new Error('connection lost'))
  await assert.rejects(store.load(), { code: 'CURSOR_OWNER_LOST' }); store.close()
})

const message = { key: '["medusa-reference","test:1"]', value: JSON.stringify({
  ingestion_id: 'ing_test', received_at: '2026-09-18T00:00:00Z',
  raw_body: JSON.stringify({ source_id: 'medusa-reference', event_id: 'test:1' }),
}) }
function kafka(failAt) {
  const calls = []
  const transaction = {
    send: async request => { calls.push(request); if (request.topic === failAt) throw new Error('failed') },
    commit: async () => { calls.push('commit'); if (failAt === 'commit') throw new Error('unknown') },
    abort: async () => { calls.push('abort') },
  }
  return { calls, publish: createKafkaPublisher({ producer: { transaction: async () => transaction }, rawTopic: 'raw', receiptTopic: 'receipts' }) }
}
test('raw and receipt are committed together with all-ISR ACKs', async () => {
  const k = kafka(); await k.publish(message)
  assert.deepEqual(k.calls.map(c => c.topic ?? c), ['raw', 'receipts', 'commit'])
  assert.equal(k.calls[0].acks, -1)
  assert.equal(k.calls[1].acks, -1)
  assert.equal(JSON.parse(k.calls[1].messages[0].value).ingestion_id, 'ing_test')
})
for (const stage of ['raw', 'receipts', 'commit']) {
  test(`failure at ${stage} rejects handoff and requires producer recreation`, async () => {
    const k = kafka(stage)
    await assert.rejects(k.publish(message), { code: 'KAFKA_HANDOFF_FAILED' })
    assert.equal(k.calls.at(-1), 'abort')
    await assert.rejects(k.publish(message), { code: 'KAFKA_PUBLISHER_FAILED' })
  })
}
