import test from 'node:test'
import assert from 'node:assert/strict'
import { loadOverviewEvidence } from '../src/lib/ai/overview-evidence.js'

const filters = { source_id: 'medusa-reference', from: '2026-09-01T00:00:00Z', to: '2026-09-02T00:00:00Z' }
const actor = { id: 'account-id', session_version: 2, role: 'super_admin' }

test('AI overview reads live capability, not token role, and uses only scoped V2 repository', async () => {
  for (const role of ['analyst','staff']) {
    let calls = 0
    const evidence = await loadOverviewEvidence({ actor, filters,
      execute: async (sql, params) => { assert.deepEqual(params, [actor.id]); return [{ role, is_active: true, session_version: 2 }] },
      repository: { getOverview: async scope => { calls++; assert.equal(scope.sourceId, filters.source_id); return { metric_state: 'OBSERVED', profiles: [] } } },
    })
    assert.equal(calls, 1)
    assert.equal(evidence.origin, 'postgres_v2')
    assert.equal(evidence.data.metric_state, 'OBSERVED')
  }
})

test('AI evidence denies Admin, stale sessions, unbounded scope and arbitrary tools before data read', async () => {
  const repository = { getOverview: () => assert.fail('must not read') }
  for (const account of [{ role: 'super_admin', is_active: true, session_version: 2 },
    { role: 'analyst', is_active: false, session_version: 2 }, { role: 'staff', is_active: true, session_version: 3 }]) {
    await assert.rejects(loadOverviewEvidence({ actor, filters, repository, execute: async () => [account] }))
  }
  const execute = async () => [{ role: 'staff', is_active: true, session_version: 2 }]
  for (const scope of [{ source_id: 'medusa-reference' }, { ...filters, sql: 'SELECT *' },
    { ...filters, to: '2027-01-01' }, { ...filters, source_id: '' }]) {
    await assert.rejects(loadOverviewEvidence({ actor, filters: scope, execute, repository }))
  }
  await assert.rejects(loadOverviewEvidence({ actor, filters, repository, execute: async () => { throw Error('database unavailable') } }))
})
