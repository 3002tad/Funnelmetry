import test from 'node:test'
import assert from 'node:assert/strict'
import { createStagingAnalysisRunner } from '../src/analysis-run.mjs'
const actor = { id: 'test-user', session_version: 1 }
const account = { role: 'analyst', session_version: 1, is_active: true }
test('analysis requires live auth dependency and rejects revoked session before compute', async () => {
  assert.throws(() => createStagingAnalysisRunner({}), /authorization/)
  const runner = createStagingAnalysisRunner({ pool: { query() { assert.fail('must not query analytics') } },
    authQuery: async () => [{ ...account, is_active: false }], statementTimeoutMs: 1000 })
  await assert.rejects(runner.run({ actor, request: {} }), /session_expired/)
})
test('invalid request persistence excludes raw input; retrieval is actor-scoped', async () => {
  let stored
  const runner = createStagingAnalysisRunner({ statementTimeoutMs: 1000, authQuery: async () => [account],
    pool: { async query(sql, values) {
      if (sql.startsWith('INSERT')) { stored = JSON.parse(values[5]); return { rows: [] } }
      assert.deepEqual(values, [stored.evidence_id, actor.id])
      return { rows: [{ document: stored }] }
    } } })
  const result = await runner.run({ actor, request: { password: 'must-not-persist' } })
  assert.equal(result.status, 'ERROR')
  assert.ok(!JSON.stringify(stored).includes('must-not-persist'))
  assert.deepEqual(await runner.get({ actor, evidenceId: result.evidence_id }), result)
})
test('storage failure returns no evidence IDs or computed values', async () => {
  const runner = createStagingAnalysisRunner({ statementTimeoutMs: 1000, authQuery: async () => [account],
    pool: { async query() { throw Error('database secret') } } })
  assert.deepEqual(await runner.run({ actor, request: {} }), { status: 'ERROR', code: 'EVIDENCE_PERSIST_FAILED', result: null })
})
test('revocation during execution prevents persistence and disclosure', async () => {
  let checks = 0
  const runner = createStagingAnalysisRunner({ statementTimeoutMs: 1000,
    authQuery: async () => [{ ...account, is_active: ++checks === 1 }],
    pool: { query() { assert.fail('revoked execution must not persist') } } })
  await assert.rejects(runner.run({ actor, request: {} }), /session_expired/)
})
test('technical admin without analytical permissions cannot execute', async () => {
  const runner = createStagingAnalysisRunner({ statementTimeoutMs: 1000,
    authQuery: async () => [{ ...account, role: 'super_admin' }],
    pool: { query() { assert.fail('forbidden execution must not query') } } })
  await assert.rejects(runner.run({ actor, request: {} }), /forbidden/)
})
