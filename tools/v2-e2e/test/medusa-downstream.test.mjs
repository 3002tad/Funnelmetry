import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { createNormalizer } from '../../../workers/canonical-normalizer/src/normalizer.js'
import { loadMappingRegistry } from '../../../workers/canonical-normalizer/src/mapping-loader.js'
import { createCanonicalLedgerRepository } from '../../../workers/canonical-ledger-writer/src/repository.js'
import { createJourneyRepository } from '../../../workers/journey-processor/src/repository.js'
import { createFunnelRepository, createFunnelProfileRepository } from '../../../workers/funnel-processor/src/repository.js'
import { REFERENCE_FUNNEL_PROFILES } from '../../../workers/funnel-processor/src/reference-profiles.js'
import { createKpiRepository } from '../../../workers/kpi-projector/src/repository.js'
import { summarizeOrders } from '../../../analytics/src/order-summary.mjs'
import { installProductRankingCatalog, rankProducts, productRankingMetadata as pm } from '../../../analytics/src/product-ranking.mjs'
import {installRankingCatalog,discoverRankingTool,rankOrders,rankingContract} from '../../../analytics/src/order-ranking.mjs'
import { installStagingOrderCatalog, executeStagingMetricSummary, discoverStagingOrderTool, ORDER_CATALOG_RELEASE } from '../../../analytics/src/semantic-registry.mjs'
import { createStagingAnalysisRunner } from '../../../analytics/src/analysis-run.mjs'
import { verifyOrderChatHttp } from './order-chat-http.mjs'

// Synthetic records with the published schema 2.0 shape; no remote API or customer data.
function events() {
  const types = ['behavior.product_viewed', 'cart.item_added', 'checkout.started', 'medusa.order_placed']
  const payloads = [
    { product_id: 'prod_test', page_instance_id: 'page:test' },
    { cart_id: 'cart_test', product_id: 'prod_test', variant_id: 'variant_test', quantity: 1 },
    { cart_id: 'cart_test', page_instance_id: 'page:test', step: 'address' },
    { order_id: 'order_test', cart_id: 'cart_test', total_amount: '20', currency_code: 'eur', amount_unit: 'major', amount_semantics: 'medusa.order.total',
      items: [{ product_id: 'prod_test', variant_id: 'variant_test', quantity: 1, unit_price_amount: '10' }] },
  ]
  return types.map((type, index) => ({
    specversion: 'ingress-event.v1', source_id: 'medusa-reference', event_id: `test:event:${index}`,
    source_event_type: type, source_schema_version: '2.0', producer: index === 1 || index === 3 ? 'source_bridge' : 'browser_sdk',
    occurred_at: `2026-09-22T12:00:0${index}.000Z`,
    correlation_id: index ? 'cart:cart_test' : 'session:session_test',
    ...(index < 3 ? { anonymous_id: 'anonymous:test', session_id: 'session_test' } : {}),
    ...(index === 1 ? { aggregate: { type: 'cart', id: 'cart_test' } } : {}),
    ...(index === 3 ? { aggregate: { type: 'order', id: 'order_test' } } : {}),
    source_payload: payloads[index],
  }))
}

test('isolated DB: Medusa v2 downstream funnel and order-grain monetary asset', async () => {
  const url = new URL(process.env.TEST_DATABASE_URL ?? 'postgres://invalid/invalid')
  // Fail closed: never migrate a normal demo database by mistake.
  assert.equal(url.pathname, '/medusa_contract_test')
  const pool = new pg.Pool({ connectionString: url.toString() })
  try {
    for (const file of ['001_canonical_ledger.sql', '002_journey_projection.sql', '003_funnel_projection.sql', '004_kpi_projection.sql',
      '006_funnel_maturity.sql', '007_maturity_finalization.sql', '008_late_conversion.sql', '009_matured_conversion.sql',
      '010_reconciliation_evidence.sql', '011_reconciliation_comparison.sql', '012_reconciliation_current_projection.sql', '018_kpi_handoff_evidence.sql']) {
      await pool.query(await readFile(new URL(`../../../infra/postgres/v2/${file}`, import.meta.url), 'utf8'))
    }
    const normalizer = createNormalizer({ registry: await loadMappingRegistry(new URL('../../../integrations/medusa/canonical-mappings.v1.json', import.meta.url)) })
    const ledger = createCanonicalLedgerRepository({ pool })
    const journey = createJourneyRepository({ pool })
    const funnel = createFunnelRepository({ pool })
    const kpi = createKpiRepository({ pool })
    await createFunnelProfileRepository({ pool }).publish({ sourceId: 'medusa-reference', profile: REFERENCE_FUNNEL_PROFILES[0] })
    const canonical = events().map(event => {
      const result = normalizer.normalize({ key: JSON.stringify([event.source_id, event.event_id]), value: JSON.stringify({ ingestion_id: `raw:${event.event_id}`, received_at: event.occurred_at, raw_body: JSON.stringify(event) }) })
      assert.equal(result.status, 'normalized')
      return result.canonicalEvent
    })
    async function apply(event) {
      const persisted = await ledger.persist(event)
      const linked = await journey.resolve(persisted.canonical_event)
      const projected = await funnel.project({ journeyId: linked.journey_id, canonicalEvent: persisted.canonical_event })
      await kpi.project({ triggerEventId: event.canonical_event_id, sourceId: event.source_id, journeyId: linked.journey_id,
        instanceIds: projected.updates.map(item => item.funnel_instance_id) })
      return { persisted, linked }
    }
    // Late delivery: order arrives before checkout, event-time projection still converges.
    for (const index of [0, 1, 3, 2]) await apply(canonical[index])
    const rows = (await pool.query('SELECT * FROM funnel_kpi_instance_facts')).rows
    assert.equal(rows.length, 1)
    assert.equal(rows[0].outcome_status, 'CONVERTED')
    assert.equal(rows[0].reached_step_count, 4)
    assert.equal(rows[0].profile_version, '2.0.0')
    const orderLink = (await pool.query('SELECT * FROM journey_events WHERE canonical_event_id=$1', [canonical[3].canonical_event_id])).rows[0]
    assert.equal(orderLink.matched_entity_type, 'CART')
    assert.equal(orderLink.link_confidence, 'STRONG')
    for (const event of canonical) {
      const result = await apply(event)
      assert.equal(result.persisted.status, 'duplicate')
      assert.equal(result.linked.status, 'duplicate')
    }
    assert.deepEqual((await pool.query('SELECT * FROM funnel_kpi_instance_facts')).rows, rows)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM journeys')).rows[0].n, 1)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM canonical_events')).rows[0].n, 4)
    // Coexisting historical created row is not another terminal event for profile 2.0.0.
    const legacy = { ...canonical[3], canonical_event_id: 'legacy_order', mapping_version: 'legacy-test-only', event_type: 'order.created' }
    await apply(legacy)
    const totals = (await pool.query('SELECT entrants, observed_converted FROM funnel_kpi_profile_observed_totals')).rows
    assert.deepEqual(totals, [{ entrants: '1', observed_converted: '1' }])
    assert.equal((await pool.query("SELECT occurrence_count FROM funnel_kpi_step_facts WHERE event_type='order.placed'")).rows[0].occurrence_count, '1')
    await pool.query(await readFile(new URL('../../../analytics/sql/fact-order-v1.sql', import.meta.url), 'utf8'))
    const fact = (await pool.query('SELECT * FROM analytical_fact_order_v1')).rows
    assert.equal(fact.length, 1)
    assert.equal(fact[0].total_amount, '20')
    assert.equal(fact[0].quality_state, 'VALID')
    assert.equal(fact[0].currency_code, 'EUR')
    // Different logical delivery IDs for the same order still count one order.
    await ledger.persist({ ...canonical[3], canonical_event_id: 'duplicate_order', source_event_id: 'duplicate_order' })
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM analytical_fact_order_v1')).rows[0].n, 1)
    await ledger.persist({ ...canonical[3], canonical_event_id: 'usd_order', source_event_id: 'usd_order',
      aggregate: { type: 'order', id: 'order_usd' },
      data: { ...canonical[3].data, order_id: 'order_usd', total_amount: '0.10', currency_code: 'usd' } })
    const amounts = (await pool.query(`SELECT currency_code, sum(total_amount)::text AS gross_order_value,
      count(*)::int AS order_count FROM analytical_fact_order_v1 GROUP BY currency_code ORDER BY currency_code`)).rows
    assert.deepEqual(amounts, [
      { currency_code: 'EUR', gross_order_value: '20', order_count: 1 },
      { currency_code: 'USD', gross_order_value: '0.10', order_count: 1 },
    ])
    const summaryRequest = { source_id: 'medusa-reference', from: '2026-09-22T00:00:00.000Z', to: '2026-09-23T00:00:00.000Z' }
    const summarize = patch => summarizeOrders({ pool, request: { ...summaryRequest, ...patch }, statementTimeoutMs: 5000 })
    const summary = await summarize({})
    await pool.query(await readFile(new URL('../../../analytics/sql/catalog-v1.sql', import.meta.url), 'utf8'))
    await installStagingOrderCatalog(pool)
    await installStagingOrderCatalog(pool) // idempotent immutable release
    assert.equal(await discoverRankingTool(pool),null)
    await installRankingCatalog(pool)
    await installRankingCatalog(pool)
    const rankingRequest={tool_id:rankingContract.id,catalog_release:rankingContract.catalog_release,
      value_refs:rankingContract.value_refs,dimension_refs:rankingContract.dimension_refs,parameters:summaryRequest}
    const ranking=await rankOrders({pool,request:rankingRequest,statementTimeoutMs:5000})
    assert.equal(ranking.status,'PROVISIONAL')
    assert.equal(ranking.result.orders.length,2)
    assert.equal(ranking.result.orders[0].currency_code,'EUR')
    assert.equal(ranking.result.orders[0].gross_order_value,'20')
    assert.equal(ranking.result.orders[0].order_id,'order_test')
    assert.equal(ranking.result.orders[1].position,'1') // separate currencies, no global ranking
    await pool.query(await readFile(new URL('../../../analytics/sql/product-value-v1.sql',import.meta.url),'utf8'))
    await installProductRankingCatalog(pool)
    const productRequest={tool_id:pm.tool_id,catalog_release:pm.catalog_release,value_refs:pm.value_refs,
      dimension_refs:pm.dimension_refs,parameters:summaryRequest}
    const products=await rankProducts({pool,request:productRequest,statementTimeoutMs:5000})
    assert.equal(products.status,'PROVISIONAL')
    // Repeated deliveries do not double quantity; order total is NOT item value.
    assert.deepEqual(products.result.products.map(r=>[r.currency_code,r.ordered_product_unit_value,r.quantity]),
      [['EUR','10','1'],['USD','10','1']])
    assert.equal((await rankProducts({pool,request:{...productRequest,sql:'SELECT 1'},statementTimeoutMs:5000})).code,'INVALID_TOOL_REQUEST')
    try {
      await pool.query(`UPDATE canonical_events SET data=jsonb_set(data,'{items}','[]'::jsonb) WHERE canonical_event_id='duplicate_order'`)
      assert.equal((await rankProducts({pool,request:productRequest,statementTimeoutMs:5000})).status,'BLOCKED_BY_QUALITY')
    } finally { await pool.query(`UPDATE canonical_events SET data=$1::jsonb WHERE canonical_event_id='duplicate_order'`,[JSON.stringify(canonical[3].data)]) }
    const discovered = await discoverStagingOrderTool(pool)
    assert.equal(discovered.id, 'tool.metric_summary')
    assert.ok(discovered.value_refs.includes('metric.average_order_value@1.0.0'))
    const toolRequest = { tool_id: 'tool.metric_summary', catalog_release: ORDER_CATALOG_RELEASE,
      value_refs: ['measure.gross_order_value@1.0.0', 'metric.average_order_value@1.0.0'],
      dimension_refs: ['dimension.currency_code@1.0.0'], parameters: summaryRequest }
    const execute = patch => executeStagingMetricSummary({ pool, request: { ...toolRequest, ...patch }, statementTimeoutMs: 5000 })
    const evidence = await execute({})
    await pool.query(await readFile(new URL('../../../analytics/sql/evidence-v1.sql', import.meta.url), 'utf8'))
    // Synthetic account query only: real permission/session verifier is reused.
    const actor = { id: 'analyst-test', session_version: 1 }
    const runner = createStagingAnalysisRunner({ pool, statementTimeoutMs: 5000,
      authQuery: async () => [{ role: 'analyst', session_version: 1, is_active: true }] })
    const saved = await runner.run({ actor, request: toolRequest })
    assert.equal(saved.status, 'PROVISIONAL')
    const restored = await runner.get({ actor, evidenceId: saved.evidence_id })
    assert.deepEqual(restored, JSON.parse(JSON.stringify(saved)))
    assert.equal(restored.result.groups[0].values['measure.gross_order_value@1.0.0'], '20')
    assert.ok(restored.provenance.warnings.includes('PLACED_ORDER_VALUE_NOT_PAID_REVENUE'))
    assert.equal(await runner.get({ actor: { ...actor, id: 'other-user' }, evidenceId: saved.evidence_id }), null)
    await assert.rejects(pool.query("UPDATE analytical_execution_evidence SET status='ERROR'"), /append-only/)
    await verifyOrderChatHttp(pool)
    assert.equal(evidence.status, 'PROVISIONAL')
    assert.equal(evidence.result.groups[0].values['measure.gross_order_value@1.0.0'], '20')
    assert.equal(evidence.semantic_context.catalog_release, ORDER_CATALOG_RELEASE)
    assert.equal((await execute({ value_refs: ['measure.revenue@1.0.0'] })).code, 'INCOMPATIBLE_SEMANTICS')
    assert.equal((await execute({ dimension_refs: [] })).code, 'INCOMPATIBLE_SEMANTICS')
    assert.equal((await execute({ tool_id: 'polars.sum' })).code, 'INVALID_TOOL_REQUEST')
    await assert.rejects(pool.query("UPDATE analytical_catalog_releases SET document='{}'::jsonb"), /immutable/)
    assert.equal(summary.status, 'PROVISIONAL')
    assert.equal(summary.result.groups.length, 2)
    assert.equal(summary.result.groups[0].gross_order_value, '20')
    assert.equal(summary.result.groups[0].order_count, '1')
    assert.match(summary.result.groups[0].average_order_value, /^20\.0+$/)
    assert.equal((await summarize({ currency_code: 'USD' })).result.groups[0].gross_order_value, '0.10')
    assert.equal((await summarize({ from: summaryRequest.to, to: '2026-09-24T00:00:00.000Z' })).status, 'INSUFFICIENT_DATA')
    await ledger.persist({ ...canonical[3], canonical_event_id: 'conflict_order', source_event_id: 'conflict_order',
      data: { ...canonical[3].data, total_amount: '21' } })
    const blocked = (await pool.query("SELECT * FROM analytical_fact_order_v1 WHERE order_id='order_test'")).rows[0]
    assert.equal(blocked.quality_state, 'BLOCKED_BY_QUALITY')
    assert.equal(blocked.reason_code, 'conflicting_order_facts')
    assert.equal(blocked.total_amount, null)
    // Even a USD-only request must not hide a conflicting EUR row with null time/currency.
    const blockedSummary = await summarize({ currency_code: 'USD' })
    assert.equal(blockedSummary.status, 'BLOCKED_BY_QUALITY')
    assert.equal((await rankOrders({pool,request:rankingRequest,statementTimeoutMs:5000})).status,'BLOCKED_BY_QUALITY')
    assert.equal(blockedSummary.result, null)
    assert.equal(blockedSummary.blocked_order_count, '1')
    assert.equal((await execute({})).status, 'BLOCKED_BY_QUALITY')
    const blockedRun = await runner.run({ actor, request: toolRequest })
    const storedBlock = await runner.get({ actor, evidenceId: blockedRun.evidence_id })
    assert.equal(storedBlock.status, 'BLOCKED_BY_QUALITY')
    assert.equal(storedBlock.result, null)
    assert.equal(storedBlock.blocked_order_count, '1')
    for (const [index, patch] of [{ total_amount: 'NaN' }, { total_amount: 20 },
      { amount_unit: 'minor' }, { currency_code: '' }, { total_amount: null }].entries()) {
      const id = `invalid_${index}`
      await ledger.persist({ ...canonical[3], canonical_event_id: id, source_event_id: id,
        aggregate: { type: 'order', id }, data: { ...canonical[3].data, order_id: id, ...patch } })
      const row = (await pool.query('SELECT * FROM analytical_fact_order_v1 WHERE order_id=$1', [id])).rows[0]
      assert.equal(row.quality_state, 'BLOCKED_BY_QUALITY')
      assert.equal(row.reason_code, 'invalid_contract')
      assert.equal(row.total_amount, null)
    }
    // Draft bindings must refer to actual columns, not inferred column names.
    const metadata = JSON.parse(await readFile(new URL('../../../analytics/metadata/order-value-v1.json', import.meta.url), 'utf8'))
    assert.equal(metadata.status, 'DRAFT')
    assert.equal(metadata.runtime_published, false)
    const columns = new Set((await pool.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1`, [metadata.asset.relation])).rows.map(row => row.column_name))
    for (const field of [...metadata.asset.grain, metadata.asset.time_basis, metadata.asset.quality_field,
      ...metadata.measures.flatMap(item => item.fields ?? [item.field]), ...metadata.dimensions.map(item => item.field)]) {
      assert.ok(columns.has(field), `Missing physical binding: ${field}`)
    }
    const amountType = (await pool.query(`SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name='total_amount'`, [metadata.asset.relation])).rows[0]
    assert.equal(amountType.data_type, 'numeric')
    // Schema1 browser replay: independent synthetic journey, delayed checkout,
    // duplicate deliveries with a new normalization timestamp, no real Feed data.
    const replayEvents=events().map(event=>({
      ...event,event_id:`schema1-replay:${event.event_id}`,
      source_schema_version:event.producer==='browser_sdk'?'1.0':event.source_schema_version,
      ...(event.session_id?{session_id:'session_replay',anonymous_id:'anonymous:replay'}:{}),
      correlation_id:event.correlation_id.startsWith('cart:')?'cart:cart_replay':'session:session_replay',
      ...(event.aggregate?{aggregate:{...event.aggregate,id:event.aggregate.type==='cart'?'cart_replay':'order_replay'}}:{}),
      source_payload:{...event.source_payload,
        ...(event.source_payload.cart_id?{cart_id:'cart_replay'}:{}),
        ...(event.source_payload.order_id?{order_id:'order_replay'}:{})},
    }))
    const rawReplay=replayEvents.map(event=>({key:JSON.stringify([event.source_id,event.event_id]),value:JSON.stringify({ingestion_id:`raw:${event.event_id}`,received_at:event.occurred_at,raw_body:JSON.stringify(event)})}))
    const replayCanonical=rawReplay.map(raw=>{
      const normalized=normalizer.normalize(raw);assert.equal(normalized.status,'normalized');return normalized.canonicalEvent
    })
    assert.equal(replayCanonical[0].mapping_version,'medusa-browser-schema1-catalog-v2')
    assert.equal(replayCanonical[2].mapping_version,'medusa-browser-schema1-catalog-v2')
    let replayJourney
    for(const index of [0,1,3,2])replayJourney=(await apply(replayCanonical[index])).linked.journey_id
    const replayFacts=(await pool.query('SELECT * FROM funnel_kpi_instance_facts WHERE journey_id=$1',[replayJourney])).rows
    assert.equal(replayFacts.length,1);assert.equal(replayFacts[0].outcome_status,'CONVERTED');assert.equal(replayFacts[0].reached_step_count,4)
    const replayCounts=async()=> (await pool.query(`SELECT
      (SELECT count(*)::int FROM canonical_events) AS canonical,
      (SELECT count(*)::int FROM journey_events) AS journey,
      (SELECT count(*)::int FROM funnel_event_applications) AS funnel,
      (SELECT count(*)::int FROM kpi_projection_applications) AS kpi`)).rows
    const beforeReplay=await replayCounts()
    for(const raw of [...rawReplay].reverse()){
      const replayed=normalizer.normalize(raw)
      const applied=await apply(replayed.canonicalEvent)
      assert.equal(applied.persisted.status,'duplicate');assert.equal(applied.linked.status,'duplicate')
    }
    assert.deepEqual(await replayCounts(),beforeReplay)
    assert.deepEqual((await pool.query('SELECT * FROM funnel_kpi_instance_facts WHERE journey_id=$1',[replayJourney])).rows,replayFacts)
    // Broken physical binding must fail closed, even with a validated release.
    await pool.query('ALTER VIEW analytical_fact_order_v1 RENAME COLUMN total_amount TO broken_amount')
    assert.equal((await execute({})).code, 'UNVERIFIED_CATALOG_OR_BINDING')
    await assert.rejects(installStagingOrderCatalog(pool), /UNVERIFIED_BINDING/)
    await assert.rejects(discoverStagingOrderTool(pool), /UNVERIFIED_BINDING/)
  } finally { await pool.end() }
})
