import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { loadAnalyticalCoverage, validateAnalyticalCoverage, validateCoverageSources,
  inspectCoverageBindings, loadAnalyticalDefinition } from '../src/analytical-coverage.mjs'

test('coverage documents every current logical V2 analytical asset with real SQL sources', async () => {
  const catalog = await loadAnalyticalCoverage()
  assert.equal(catalog.runtime_published, false)
  assert.equal(catalog.assets.length, 16)
  await validateCoverageSources(catalog)
  assert(catalog.assets.every(asset => !/dashboard_users|credential|secret|chat_messages/.test(asset.relation)))
  assert(catalog.assets.filter(asset => asset.availability === 'DOCUMENTED_ONLY')
    .every(asset => asset.tool_refs.length === 0 && asset.supported_operations.length === 0))
})

test('coverage rejects missing assets, unsafe relation, invented fields and false tool claims', async () => {
  const catalog = await loadAnalyticalCoverage()
  const missing = structuredClone(catalog)
  missing.assets.pop()
  assert.throws(() => validateAnalyticalCoverage(missing), /missing or unexpected logical asset/)

  const secret = structuredClone(catalog)
  secret.assets[0].relation = 'public.dashboard_users'
  assert.throws(() => validateAnalyticalCoverage(secret), /asset identity\/binding/)

  const invented = structuredClone(catalog)
  invented.assets[0].dimensions.push('customer_id')
  assert.throws(() => validateAnalyticalCoverage(invented), /grain\/dimension\/time/)

  const unsupported = structuredClone(catalog)
  const journey = unsupported.assets.find(asset => asset.id === 'asset.journey')
  journey.tool_refs.push('tool.customer_retention')
  assert.throws(() => validateAnalyticalCoverage(unsupported), /executable claim/)

  const fakeTool = structuredClone(catalog)
  fakeTool.assets[0].tool_refs.push('tool.any_sql')
  assert.throws(() => validateAnalyticalCoverage(fakeTool), /empty semantic/)

  const paid = structuredClone(catalog)
  paid.assets.find(asset => asset.id === 'asset.fact_order').measures[0].id = 'measure.revenue'
  assert.throws(() => validateAnalyticalCoverage(paid), /measure authority/)

  const fanout = structuredClone(catalog)
  const item = fanout.assets.find(asset => asset.id === 'asset.ordered_product_item')
  item.relationships[0].keys = ['product_id']
  assert.throws(() => validateAnalyticalCoverage(fanout), /relationship/)
})

test('one metadata file retains both staged monetary definitions and rejects semantic drift', async () => {
  const order = await loadAnalyticalDefinition('asset.fact_order')
  const product = await loadAnalyticalDefinition('asset.ordered_product_item')
  assert.equal(order.asset.relation, 'analytical_fact_order_v1')
  assert.deepEqual(order.asset.grain, ['source_id', 'order_id'])
  assert.deepEqual(order.metrics, [{ id: 'metric.average_order_value',
    numerator: 'measure.gross_order_value', denominator: 'measure.order_count', zero_denominator: 'null' }])
  assert.equal(order.policies['measure.revenue'], 'unavailable_for_this_baseline; not_an_alias')
  assert.equal(product.binding, 'public.analytical_product_order_items_v1')
  assert.equal(product.formula, 'SUM(point_in_time_unit_price_amount * quantity)')
  assert.equal(product.policies.revenue, 'not paid/net revenue and not allocated order total')
  // Pin the former standalone definition objects: persisted staging release documents stay compatible.
  const digest = definition => createHash('sha256').update(JSON.stringify(definition)).digest('hex')
  assert.equal(digest(order), 'b4af8d46e3ed3699b6579276e6e4f268a0b554cd1dcea5b88278f63cc45c9b59')
  assert.equal(digest(product), '86db30ba3479a5b071de34448bcb7af0a73f99b5953d1addf0eec1332a41a6cd')
  const catalog = await loadAnalyticalCoverage()
  const drift = structuredClone(catalog)
  drift.assets.find(asset => asset.id === 'asset.fact_order').definition.metrics[0].denominator = 'measure.revenue'
  assert.throws(() => validateAnalyticalCoverage(drift), /definition semantics/)
  const missing = structuredClone(catalog)
  delete missing.assets.find(asset => asset.id === 'asset.ordered_product_item').definition
  assert.throws(() => validateAnalyticalCoverage(missing), /definition status/)
  await assert.rejects(loadAnalyticalDefinition('asset.unknown'), /unknown detailed definition/)
})

test('read-only physical inspection reports missing or mistyped columns as UNVERIFIED', async () => {
  const catalog = await loadAnalyticalCoverage()
  const byRelation = new Map(catalog.assets.map(asset => [asset.relation.slice(7), asset]))
  const calls = []
  const pool = { async query(sql, params) {
    calls.push({ sql, params })
    const asset = byRelation.get(params[1])
    const entries = Object.entries(asset.required_columns)
    const rows = entries.map(([column_name, data_type]) => ({ column_name, data_type }))
    if (params[1] === 'analytical_fact_order_v1') rows.find(row => row.column_name === 'total_amount').data_type = 'text'
    return { rows }
  } }
  const result = await inspectCoverageBindings(pool, catalog)
  assert.equal(result.runtime_published, false)
  assert.equal(calls.length, catalog.assets.length)
  assert(calls.every(call => call.sql.includes('information_schema.columns') && call.params[0] === 'public'))
  assert.equal(result.results.filter(item => item.status === 'UNVERIFIED').length, 1)
  assert.deepEqual(result.results.find(item => item.id === 'asset.fact_order').mismatched_columns, ['total_amount'])
})

test('binding inspection fails closed on database errors', async () => {
  const catalog = await loadAnalyticalCoverage()
  const result = await inspectCoverageBindings({ query: async () => { throw Error('database unavailable') } }, catalog)
  assert(result.results.every(item => item.status === 'UNVERIFIED'))
})
