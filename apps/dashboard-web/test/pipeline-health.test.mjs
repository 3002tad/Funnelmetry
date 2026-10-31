import test from 'node:test'
import assert from 'node:assert/strict'
import { parsePipelineHealth } from '../src/lib/pipeline-health.ts'

test('admin health rejects a malformed successful response instead of crashing the UI', () => {
  assert.throws(() => parsePipelineHealth({}), /Invalid pipeline health response/)
  assert.throws(() => parsePipelineHealth({ checked_at: '2026-10-31T00:00:00Z', metrics: {}, unavailable: [] }), /Invalid pipeline health response/)
  const snapshot = {
    source_id: 'medusa-reference', checked_at: '2026-10-31T00:00:00Z', runtime_status: 'UNVERIFIED',
    metrics: { accepted: 1, terminal: 1, canonical: 1, kpi_applications: 1, pending_claims: 0,
      last_canonical_at: null, last_kpi_at: null }, unavailable: [],
  }
  assert.equal(parsePipelineHealth(snapshot), snapshot)
})
