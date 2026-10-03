import { readFile } from 'node:fs/promises'
import { isDeepStrictEqual } from 'node:util'
import { discoverStagingOrderTool } from './semantic-registry.mjs'
import { attachProductReferences } from '../../apps/dashboard-api/src/lib/product-reference.js'

export const productRankingMetadata = JSON.parse(await readFile(new URL('../metadata/product-value-v1.json', import.meta.url), 'utf8'))
const m = productRankingMetadata
export async function installProductRankingCatalog(pool) {
  await discoverStagingOrderTool(pool)
  await pool.query(`INSERT INTO analytical_catalog_releases(release_id,document,status)
    VALUES ($1,$2::jsonb,'VALIDATED_STAGING') ON CONFLICT (release_id) DO NOTHING`,[m.catalog_release,JSON.stringify(m)])
  await discoverProductRankingTool(pool)
}
export async function discoverProductRankingTool(pool) {
  await discoverStagingOrderTool(pool)
  const { rows: [row] } = await pool.query('SELECT document,status FROM analytical_catalog_releases WHERE release_id=$1', [m.catalog_release])
  if (!row) return null
  if (row.status !== 'VALIDATED_STAGING' || !isDeepStrictEqual(row.document, m)) throw Error('UNVERIFIED_PRODUCT_CATALOG')
  const { rows } = await pool.query(`SELECT column_name,data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='analytical_product_order_items_v1'`)
  const actual = Object.fromEntries(rows.map(r => [r.column_name,r.data_type]))
  for (const [name,type] of Object.entries({ source_id:'text',order_id:'text',product_id:'text',currency_code:'text',
    order_placed_at:'timestamp with time zone',ordered_product_unit_value:'numeric',quantity:'numeric',
    quality_state:'text',canonical_event_ids:'ARRAY',item_position:'bigint' })) {
    if (actual[name] !== type) throw Error('UNVERIFIED_PRODUCT_BINDING')
  }
  return structuredClone(m)
}

export async function rankProducts({ pool, request, statementTimeoutMs }) {
  const error = code => ({status:'ERROR',code,result:null})
  const p = request?.parameters
  const iso = v => typeof v==='string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v
  if (!request || Object.keys(request).sort().join(',') !== 'catalog_release,dimension_refs,parameters,tool_id,value_refs'
    || request.tool_id!==m.tool_id || request.catalog_release!==m.catalog_release
    || !isDeepStrictEqual(request.value_refs,m.value_refs) || !isDeepStrictEqual(request.dimension_refs,m.dimension_refs)
    || !p || Object.keys(p).sort().join(',')!=='from,source_id,to' || p.source_id!=='medusa-reference'
    || !iso(p.from) || !iso(p.to) || p.from>=p.to || Date.parse(p.to)-Date.parse(p.from)>90*86400000
    || !Number.isSafeInteger(statementTimeoutMs) || statementTimeoutMs<=0) return error('INVALID_TOOL_REQUEST')
  try { if (!await discoverProductRankingTool(pool)) return error('UNVERIFIED_PRODUCT_CATALOG') }
  catch { return error('UNVERIFIED_PRODUCT_CATALOG_OR_BINDING') }
  const provenance = { parameters:{...p},implementation_version:'product-value-staged-v1',metadata_status:'DRAFT',
    binding_ref:m.binding,grain:m.output_grain,time_basis:m.time_basis,interval:'[from,to)',
    warnings:['UNIT_PRICE_TIMES_QUANTITY_NOT_PAID_REVENUE','NO_ORDER_TOTAL_ALLOCATION',
      'SOURCE_UNIT_PRICE_TAX_DISCOUNT_POLICY_UNVERIFIED','FEED_COMPLETENESS_FRESHNESS_RECONCILIATION_UNVERIFIED','DRAFT_METADATA_NOT_RUNTIME_PUBLISHED'] }
  const semantic_context = {tool_id:m.tool_id,tool_contract_version:m.version,catalog_release:m.catalog_release,
    value_refs:m.value_refs,dimension_refs:m.dimension_refs}
  let client
  try {
    client=await pool.connect()
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await client.query("SELECT set_config('statement_timeout',$1,true)",[String(statementTimeoutMs)])
    const {rows:[gate]}=await client.query(`SELECT count(*) FILTER(WHERE quality_state<>'VALID')::text AS blocked,
      transaction_timestamp() AS snapshot_at FROM analytical_product_order_items_v1 WHERE source_id=$1`,[p.source_id])
    provenance.snapshot_at=gate.snapshot_at
    if(gate.blocked!=='0') return {status:'BLOCKED_BY_QUALITY',result:null,provenance,semantic_context}
    const {rows:products}=await client.query(`WITH totals AS (
      SELECT product_id,currency_code,sum(ordered_product_unit_value) AS amount,sum(quantity) AS units,
        count(DISTINCT order_id) AS order_count
      FROM analytical_product_order_items_v1
      WHERE source_id=$1 AND order_placed_at >= $2::timestamptz AND order_placed_at < $3::timestamptz
      GROUP BY product_id,currency_code
    ), ranked AS (
      SELECT *,row_number() OVER(PARTITION BY currency_code ORDER BY amount DESC,product_id ASC) AS position FROM totals
    ) SELECT product_id,currency_code,amount::text AS ordered_product_unit_value,units::text AS quantity,
      order_count::text,position::text FROM ranked WHERE position<=5 ORDER BY currency_code,position LIMIT 1001`,[p.source_id,p.from,p.to])
    if(products.length>1000) return {...error('RESULT_BUDGET_EXCEEDED'),provenance,semantic_context}
    const named=await attachProductReferences(async (sql,args)=>(await client.query(sql,args)).rows,p.source_id,products)
    provenance.warnings.push('CATALOG_NAMES_ARE_CURRENT_NOT_HISTORICAL')
    if(named.some(row=>!row.reference)) provenance.warnings.push('MISSING_PRODUCT_REFERENCE_NAMES')
    return {status:products.length?'PROVISIONAL':'INSUFFICIENT_DATA',quality_state:'PROVISIONAL',
      result:{groups:[],products:named,limit_per_currency:5},provenance,semantic_context}
  } catch { return {...error('PRODUCT_RANKING_EXECUTION_FAILED'),provenance,semantic_context} }
  finally { if(client) { try { await client.query('ROLLBACK') } finally { client.release() } } }
}
