import test from 'node:test'
import assert from 'node:assert/strict'
import { summarizeOrders } from '../src/order-summary.mjs'

const request = { source_id: 'medusa-reference', from: '2026-09-22T00:00:00.000Z', to: '2026-09-23T00:00:00.000Z' }
test('rejects unsupported scope, currency, dates and SQL/filter extensions before DB access', async () => {
  for (const patch of [{ source_id: 'other' }, { currency_code: "EUR'; DROP TABLE x" }, { from: '2026-02-30T00:00:00.000Z' },
    { from: request.to }, { currency_code: null }, { group_by: 'product_id' }, { measure: 'revenue' }]) {
    const result = await summarizeOrders({ pool: { connect() { assert.fail('must not access DB') } }, request: { ...request, ...patch }, statementTimeoutMs: 1000 })
    assert.equal(result.code, 'INVALID_REQUEST')
  }
})
test('execution failure rolls back, releases and never exposes driver secrets', async () => {
  const calls = []
  const result = await summarizeOrders({ request, statementTimeoutMs: 1000, pool: { async connect() {
    return { async query(sql) { calls.push(sql); if (sql.startsWith('WITH')) throw Error('postgres://secret'); }, release() { calls.push('release') } }
  } } })
  assert.equal(result.status, 'ERROR')
  assert.deepEqual(calls.slice(-2), ['ROLLBACK', 'release'])
  assert.ok(!JSON.stringify(result).includes('postgres://secret'))
})
test('quality blocking withholds totals and retains draft warnings', async () => {
  const calls = []
  const result = await summarizeOrders({ request: { ...request, currency_code: 'USD' }, statementTimeoutMs: 1000,
    pool: { async connect() { return {
      async query(sql, params) {
        calls.push({ sql, params })
        return { rows: [{ blocked_count: '2', snapshot_at: '2026-09-24T00:00:00.000Z', groups: [] }] }
      }, release() { calls.push({ sql: 'release' }) },
    } } } })
  assert.equal(result.status, 'BLOCKED_BY_QUALITY')
  assert.equal(result.result, null)
  assert.equal(result.gate_scope, 'entire_source')
  assert.equal(result.provenance.metadata_status, 'DRAFT')
  assert.ok(result.provenance.warnings.includes('FEED_COMPLETENESS_FRESHNESS_RECONCILIATION_UNVERIFIED'))
  assert.match(calls[0].sql, /READ ONLY/)
  assert.deepEqual(calls.find(call => call.sql.startsWith('WITH')).params, [request.source_id, request.from, request.to, 'USD'])
  assert.equal(calls.at(-1).sql, 'release')
})
