import test from 'node:test'
import assert from 'node:assert/strict'
import { renderOrderSummary } from '../src/lib/ai/order-summary-render.js'
const fixture = () => ({ status: 'PROVISIONAL', quality_state: 'PROVISIONAL', evidence_id: 'test-evidence-1',
  provenance: { parameters: { source_id: 'medusa-reference', from: '2026-09-22T00:00:00.000Z', to: '2026-09-23T00:00:00.000Z' },
    warnings: ['FEED_COMPLETENESS_UNVERIFIED', 'PLACED_ORDER_VALUE_NOT_PAID_REVENUE'] },
  result: { groups: [{ currency_code: 'EUR', values: { 'measure.gross_order_value@1.0.0': '9007199254740993.123456789',
    'measure.order_count@1.0.0': '2', 'metric.average_order_value@1.0.0': '4503599627370496.5617283945' } },
  { currency_code: 'USD', values: { 'measure.gross_order_value@1.0.0': '0.10' } }] } })
test('deterministic answer preserves exact decimals, currency, UTC scope, evidence and warnings', () => {
  const evidence = fixture(), text = renderOrderSummary(evidence)
  assert.equal(text, renderOrderSummary(evidence))
  for (const value of ['9007199254740993.123456789 EUR', '0.10 USD', '4503599627370496.5617283945 EUR',
    'medusa-reference', evidence.provenance.parameters.from, 'test-evidence-1', 'Chưa xác minh dữ liệu đã đầy đủ']) assert.ok(text.includes(value))
  assert.ok(text.startsWith('Giá trị đơn hàng đã đặt'))
  assert.ok(!text.includes('+'))
})
test('trims redundant fractional zeros without rounding or mutating evidence', () => {
  const evidence = fixture()
  evidence.result.groups[0].values['metric.average_order_value@1.0.0'] = '20.0000000000000000'
  evidence.provenance.warnings.push('FUTURE_UNKNOWN_WARNING')
  const before = JSON.stringify(evidence)
  const text = renderOrderSummary(evidence)
  assert.ok(text.includes('AOV) 20.00 EUR'))
  assert.ok(!text.includes('20.0000000000000000'))
  assert.ok(text.includes('FUTURE_UNKNOWN_WARNING'))
  assert.equal(JSON.stringify(evidence), before)
})
test('blocks malformed money, duplicate currency, missing warnings and unsafe text', () => {
  for (const mutate of [e => { e.result.groups[0].values['measure.gross_order_value@1.0.0'] = 20 },
    e => { e.result.groups.push(e.result.groups[0]) }, e => { e.provenance.warnings = [] },
    e => { e.provenance.warnings = ['<script>bad</script>'] }, e => { e.evidence_id = '[injected](https://example.com)' },
    e => { e.status = 'BLOCKED_BY_QUALITY' }]) {
    const evidence = fixture(); mutate(evidence)
    assert.throws(() => renderOrderSummary(evidence), /invalid_order_evidence/)
  }
})
