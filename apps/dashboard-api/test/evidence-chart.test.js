import test from 'node:test'
import assert from 'node:assert/strict'
import { buildEvidenceChart, wantsEvidenceChart } from '../src/lib/ai/evidence-chart.js'

test('chart request only changes presentation, not the selected analytical tool', () => {
  assert.equal(wantsEvidenceChart('Vẽ biểu đồ top 5 sản phẩm'), true)
  assert.equal(wantsEvidenceChart('Show a chart of event counts'), true)
  assert.equal(wantsEvidenceChart('Sản phẩm nào đứng đầu?'), false)
})

test('event chart uses verified evidence counts, bounds rows and keeps evidence reference', () => {
  const counts = Array.from({ length: 14 }, (_, i) => ({ event_type: `event.${i}`, count: i }))
  const evidence = { evidence_id: 'event-counts-v1', data: { counts } }
  const result = buildEvidenceChart('event_counts', evidence)
  assert.equal(result.evidence_id, 'event-counts-v1')
  assert.equal(result.panels[0].items.length, 12)
  assert.deepEqual(result.panels[0].items[0], { label: 'event.13', value: '13' })
  assert.equal(result.truncated, true)
  assert.equal(buildEvidenceChart('event_counts', { ...evidence, data: { counts: [{ event_type: 'a', count: -1 }] } }), null)
})

test('ranked monetary charts preserve decimal strings, separate currencies and obey quality gate', () => {
  const evidence = { evidence_id: 'ev-1', status: 'PROVISIONAL', quality_state: 'PROVISIONAL',
    result: { products: [
      { currency_code: 'USD', product_id: 'prod_us', ordered_product_unit_value: '9007199254740993.123', position: '1' },
      { currency_code: 'EUR', product_id: 'prod_eu', ordered_product_unit_value: '20.01', position: '1' },
    ] } }
  const chart = buildEvidenceChart('tool.product_value_ranking', evidence)
  assert.deepEqual(chart.panels.map(panel => panel.label), ['EUR', 'USD'])
  assert.equal(chart.panels[1].items[0].value, '9007199254740993.123')
  assert.equal(buildEvidenceChart('tool.product_value_ranking', { ...evidence, status: 'BLOCKED_BY_QUALITY' }), null)
  assert.equal(buildEvidenceChart('tool.product_value_ranking', { ...evidence, result: { products: [
    { currency_code: 'EUR', product_id: 'prod_eu', ordered_product_unit_value: 'NaN', position: '1' },
  ] } }), null)
  assert.equal(buildEvidenceChart('tool.metric_summary', evidence), null)
})
