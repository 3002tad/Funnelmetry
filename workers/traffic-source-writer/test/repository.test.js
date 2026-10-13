import assert from 'node:assert/strict'
import test from 'node:test'
import { createTrafficSourceRepository, TrafficSourceConflictError } from '../src/repository.js'

const observation = {
  source_id: 'medusa-reference', source_event_id: 'browser:event-1',
  source_event_type: 'behavior.page_viewed', source_schema_version: '1.0',
  raw_record_id: 'ing_feed_1', raw_content_hash: 'a'.repeat(64),
  received_at: '2026-10-12T00:00:01.000Z', utm_source_state: 'PRESENT',
  utm_source_hash: 'b'.repeat(64), synthetic: false,
}

function fakePool({ inserted = true, identical = true, fail = false } = {}) {
  const calls = []
  let released = false
  const client = {
    async query(sql, params) {
      calls.push({ sql: sql.trim(), params })
      if (fail && sql.includes('INSERT INTO')) throw Error('private database error')
      if (sql.includes('INSERT INTO')) return { rowCount: inserted ? 1 : 0, rows: inserted ? [{}] : [] }
      if (sql.includes('SELECT')) return { rowCount: 1, rows: [{ identical }] }
      return { rowCount: 0, rows: [] }
    },
    release() { released = true },
  }
  return { calls, get released() { return released }, connect: async () => client }
}

test('inserts only hashed UTM data in a transaction', async () => {
  const pool = fakePool()
  assert.deepEqual(await createTrafficSourceRepository({ pool }).persist(observation), { status: 'inserted' })
  assert.deepEqual(pool.calls.map(call => call.sql.split(/\s+/)[0]), ['BEGIN', 'INSERT', 'COMMIT'])
  assert.equal(pool.calls[1].params[8], observation.utm_source_hash)
  assert.equal(pool.released, true)
})

test('idempotent replay accepts equal raw body despite a new received_at or raw record ID', async () => {
  const pool = fakePool({ inserted: false, identical: true })
  assert.deepEqual(await createTrafficSourceRepository({ pool }).persist({ ...observation,
    raw_record_id: 'later-replay', received_at: '2026-10-13T00:00:00.000Z' }), { status: 'duplicate' })
  assert.doesNotMatch(pool.calls[2].sql, /received_at|raw_record_id/)
})

test('conflicting event identity or database failure rolls back before Kafka ACK', async () => {
  for (const options of [{ inserted: false, identical: false }, { fail: true }]) {
    const pool = fakePool(options)
    await assert.rejects(() => createTrafficSourceRepository({ pool }).persist(observation),
      options.fail ? /private database error/ : TrafficSourceConflictError)
    assert.equal(pool.calls.at(-1).sql, 'ROLLBACK')
    assert.equal(pool.released, true)
  }
})

test('invalid observation is rejected before connecting to PostgreSQL', async () => {
  let connected = false
  const repository = createTrafficSourceRepository({ pool: { connect: async () => { connected = true } } })
  await assert.rejects(() => repository.persist({ ...observation, utm_source_hash: 'raw-value' }),
    /invalid_traffic_observation/)
  assert.equal(connected, false)
})
