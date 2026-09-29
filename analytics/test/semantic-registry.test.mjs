import test from 'node:test'
import assert from 'node:assert/strict'
import { executeStagingMetricSummary, ORDER_CATALOG_RELEASE } from '../src/semantic-registry.mjs'
const base = { tool_id: 'tool.metric_summary', catalog_release: ORDER_CATALOG_RELEASE,
  value_refs: ['measure.order_count@1.0.0'], dimension_refs: ['dimension.currency_code@1.0.0'], parameters: {} }
test('registry rejects arbitrary dispatch, unpinned releases and duplicate refs before DB', async () => {
  for (const patch of [{ tool_id: 'eval' }, { catalog_release: 'latest' }, { sql: 'SELECT 1' },
    { value_refs: [] }, { value_refs: ['x', 'x'] }, { dimension_refs: null }]) {
    const result = await executeStagingMetricSummary({ pool: { query() { assert.fail('DB must not be called') } }, request: { ...base, ...patch }, statementTimeoutMs: 1000 })
    assert.equal(result.code, 'INVALID_TOOL_REQUEST')
  }
})
test('missing or tampered catalog never falls back to local execution', async () => {
  for (const rows of [[], [{ status: 'VALIDATED_STAGING', document: {} }]]) {
    const result = await executeStagingMetricSummary({ pool: { async query() { return { rows } } }, request: base, statementTimeoutMs: 1000 })
    assert.equal(result.code, 'UNVERIFIED_CATALOG')
    assert.equal(result.result, null)
  }
})
