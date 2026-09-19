import test from 'node:test'
import assert from 'node:assert/strict'
import { INGRESS_EVENT_SPEC_VERSION } from '@3002tad/funnelmetry-input-contract'
import { createConnector, validateFeed, toRawMessage } from '../src/connector.js'
import { createFeedClient } from '../src/feed-client.js'

const cursor = { event_feed_id: 'feed-test', after_seq: 0 }
function record(seq) {
  return { event_feed_id: 'feed-test', ingress_seq: seq, accepted_at: '2026-09-18T00:00:00.000Z',
    specversion: INGRESS_EVENT_SPEC_VERSION, source_id: 'medusa-reference', event_id: `test:${seq}`,
    producer: 'browser_sdk', source_event_type: 'behavior.page_viewed', source_schema_version: '1.0',
    occurred_at: '2026-09-18T00:00:00.000Z', source_payload: {} }
}
function feed(seqs = [1, 3, 4], after = 0) {
  return { event_feed_id: 'feed-test', events: seqs.map(record), next_after_seq: seqs.at(-1) ?? after,
    latest_available_seq: Math.max(after, ...seqs), earliest_available_seq: seqs[0] ?? null, retention_floor_seq: 0 }
}
function harness({ failPublish, failSave } = {}) {
  let stored = { ...cursor }
  const published = [], operations = []
  const deps = {
    feedClient: { read: async c => feed([1, 3, 4].filter(n => n > c.after_seq), c.after_seq) },
    cursorStore: { load: async () => ({ ...stored }), advance: async (expected, next) => {
      assert.deepEqual(expected, stored)
      operations.push(`save:${next.after_seq}`)
      if (failSave) throw new Error('db unavailable')
      stored = { ...next }
    } },
    publish: async message => {
      const seq = JSON.parse(message.value).ingress_seq
      operations.push(`publish:${seq}`)
      if (seq === failPublish) throw new Error('broker unavailable')
      published.push(seq)
    },
  }
  return { deps, published, operations, stored: () => stored }
}

test('non-gapless feed advances only after each acknowledged record', async () => {
  const h = harness()
  await createConnector(h.deps).pollOnce()
  assert.equal(h.stored().after_seq, 4)
  assert.deepEqual(h.operations, ['publish:1', 'save:1', 'publish:3', 'save:3', 'publish:4', 'save:4'])
})
test('partial failure stops before later records and restart resumes prefix', async () => {
  const h = harness({ failPublish: 3 })
  await assert.rejects(createConnector(h.deps).pollOnce(), /broker/)
  assert.equal(h.stored().after_seq, 1)
  const replay = []
  await createConnector({ ...h.deps, publish: async m => replay.push(JSON.parse(m.value).ingress_seq) }).pollOnce()
  assert.deepEqual(replay, [3, 4])
})
test('ACK followed by failed cursor persistence causes safe republish', async () => {
  const h = harness({ failSave: true })
  await assert.rejects(createConnector(h.deps).pollOnce(), /db/)
  await assert.rejects(createConnector(h.deps).pollOnce(), /db/)
  assert.deepEqual(h.published, [1, 1])
  assert.equal(h.stored().after_seq, 0)
})
for (const [name, change, code] of [
  ['feed lineage', f => f.event_feed_id = 'other', 'FEED_ID_MISMATCH'],
  ['record lineage', f => f.events[1].event_feed_id = 'other', 'FEED_ID_MISMATCH'],
  ['retention floor', f => f.retention_floor_seq = 1, 'RETENTION_GAP'],
  ['duplicate sequence', f => f.events[1].ingress_seq = 1, 'INVALID_FEED'],
  ['cursor jumping past returned records', f => f.next_after_seq = 5, 'INVALID_FEED'],
  ['invalid event', f => delete f.events[1].source_id, 'INVALID_SOURCE_EVENT'],
  ['invalid accepted timestamp', f => f.events[0].accepted_at = 'bad', 'INVALID_FEED'],
]) {
  test(`reject ${name} before publishing any record`, async () => {
    const h = harness(), f = feed(); change(f)
    h.deps.feedClient.read = async () => f
    await assert.rejects(createConnector(h.deps).pollOnce(), { code })
    assert.deepEqual(h.published, [])
  })
}
test('empty feed does not save or publish', async () => {
  const h = harness(); h.deps.feedClient.read = async () => feed([])
  await createConnector(h.deps).pollOnce()
  assert.deepEqual(h.operations, [])
})
test('owner lost while awaiting feed prevents publish', async () => {
  const h = harness()
  h.deps.cursorStore.assertOwned = async () => { throw new Error('owner lost') }
  await assert.rejects(createConnector(h.deps).pollOnce(), /owner lost/)
  assert.deepEqual(h.published, [])
})
test('earliest available sequence is not a retention watermark', () => {
  assert.equal(validateFeed(feed([100, 103]), cursor, 100).length, 2)
})
test('raw format keeps source event isolated and stable ingestion identity', () => {
  const a = toRawMessage(record(1), '2026-09-18T01:00:00Z')
  const b = toRawMessage(record(1), '2026-09-18T02:00:00Z')
  assert.equal(JSON.parse(a.value).ingestion_id, JSON.parse(b.value).ingestion_id)
  assert.equal(JSON.parse(JSON.parse(a.value).raw_body).ingress_seq, undefined)
  assert.deepEqual(JSON.parse(a.key), ['medusa-reference', 'test:1'])
})
test('single-flight guard prevents concurrent polling', async () => {
  const h = harness(); let release
  h.deps.feedClient.read = () => new Promise(resolve => { release = resolve })
  const connector = createConnector(h.deps), first = connector.pollOnce()
  await Promise.resolve()
  await assert.rejects(connector.pollOnce(), { code: 'POLL_ALREADY_RUNNING' })
  release(feed([])); await first
})
test('client uses auth, bounded long poll, no redirects', async () => {
  const client = createFeedClient({ url: 'https://source.example/v1/events', token: 'test-only', fetchImpl: async (url, options) => {
    assert.equal(url.searchParams.get('after_seq'), '0')
    assert.equal(url.searchParams.get('wait'), '25')
    assert.equal(options.headers.authorization, 'Bearer test-only')
    assert.equal(options.redirect, 'error')
    return new Response(JSON.stringify(feed()))
  } })
  assert.equal((await client.read({ ...cursor, limit: 100 })).events.length, 3)
})
test('client rejects insecure URLs and insufficient timeout', () => {
  assert.throws(() => createFeedClient({ url: 'http://source.example', token: 'x' }), { code: 'INVALID_FEED_URL' })
  assert.throws(() => createFeedClient({ url: 'https://source.example', token: 'x', timeoutMs: 1000 }), { code: 'INVALID_FEED_LIMITS' })
})
test('oversized responses fail closed', async () => {
  const client = createFeedClient({ url: 'https://source.example', token: 'x', maxResponseBytes: 2,
    fetchImpl: async () => new Response('123') })
  await assert.rejects(client.read({ ...cursor, limit: 1 }), { code: 'FEED_TOO_LARGE' })
})
test('remote error content is not exposed', async () => {
  const client = createFeedClient({ url: 'https://source.example', token: 'x',
    fetchImpl: async () => new Response('private remote body', { status: 401 }) })
  await assert.rejects(client.read({ ...cursor, limit: 1 }), { message: 'FEED_HTTP_401' })
})
