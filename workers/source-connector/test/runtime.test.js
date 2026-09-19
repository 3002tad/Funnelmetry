import test from 'node:test'
import assert from 'node:assert/strict'
import { loadConfig } from '../src/config.js'
import { supervise } from '../src/supervisor.js'

const env = { SOURCE_CONNECTOR_MODE: 'NORMAL', SOURCE_CONNECTOR_ID: 'test', SOURCE_EVENT_FEED_URL: 'https://source.example/v1/events',
  SOURCE_EVENT_FEED_TOKEN: 'test-only', SOURCE_EVENT_FEED_ID: 'feed-test', SOURCE_INITIAL_AFTER_SEQ: '0',
  SOURCE_CONNECTOR_DATABASE_URL: 'postgresql://localhost/test', KAFKA_BOOTSTRAP_SERVERS: 'localhost:9092' }
test('runtime requires explicit bootstrap and rejects unsupported restore', () => {
  assert.equal(loadConfig(env).initialCursor.after_seq, 0)
  assert.throws(() => loadConfig({ ...env, SOURCE_INITIAL_AFTER_SEQ: undefined }))
  assert.throws(() => loadConfig({ ...env, SOURCE_CONNECTOR_MODE: 'RESTORE_REPLAY' }), { code: 'RESTORE_MODE_NOT_IMPLEMENTED' })
})
test('dependency outage closes session, backs off and reopens', async () => {
  const controller = new AbortController(), state = {}, history = []
  let opens = 0
  await supervise({ signal: controller.signal, state, log: x => history.push(x.status),
    sleep: async () => history.push('backoff'),
    openSession: async () => ({ pollOnce: async () => {
      if (++opens === 1) throw Object.assign(new Error(), { code: 'KAFKA_HANDOFF_FAILED' })
      controller.abort(); return { count: 1, cursor: { after_seq: 1 } }
    }, close: async () => history.push('close') }),
  })
  assert.deepEqual(history, ['DEGRADED', 'close', 'backoff', 'close'])
  assert.equal(state.status, 'STOPPED')
})
test('lineage/auth failure blocks instead of retry/restart storm', async () => {
  const controller = new AbortController(), state = {}; let opens = 0
  await supervise({ signal: controller.signal, state, log: () => {}, sleep: async () => controller.abort(),
    openSession: async () => { opens++; throw Object.assign(new Error(), { code: 'FEED_ID_MISMATCH' }) },
  })
  assert.equal(opens, 1)
  assert.equal(state.error, 'FEED_ID_MISMATCH')
})
