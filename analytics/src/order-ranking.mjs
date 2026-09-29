import {isDeepStrictEqual} from 'node:util'
import {discoverStagingOrderTool} from './semantic-registry.mjs'

export const RANKING_RELEASE='order-ranking-staging-1.0.0'
export const rankingContract={id:'tool.order_ranking',version:'1.0.0',catalog_release:RANKING_RELEASE,
  binding:'public.analytical_fact_order_v1',grain:['source_id','order_id'],time_basis:'order_placed_at',
  value_refs:['measure.gross_order_value@1.0.0'],dimension_refs:['dimension.currency_code@1.0.0'],
  limit_per_currency:5,ordering:'total_amount DESC, order_id ASC',
  description:'Top 5 placed orders by gross order value PER currency, not paid revenue. No product/customer/day ranking. Ties use order ID; no cross-currency ranking.'}

export async function installRankingCatalog(pool){
  await discoverStagingOrderTool(pool) // reviewed base metadata and real physical binding required
  await pool.query(`INSERT INTO analytical_catalog_releases(release_id,document,status)
    VALUES ($1,$2::jsonb,'VALIDATED_STAGING') ON CONFLICT (release_id) DO NOTHING`,[RANKING_RELEASE,JSON.stringify(rankingContract)])
  if(!await discoverRankingTool(pool))throw Error('UNVERIFIED_RANKING_CATALOG')
}
export async function discoverRankingTool(pool){
  const {rows:[row]}=await pool.query('SELECT document,status FROM analytical_catalog_releases WHERE release_id=$1',[RANKING_RELEASE])
  if(!row)return null // deployment opt-in; existing summary still works
  if(row.status!=='VALIDATED_STAGING'||!isDeepStrictEqual(row.document,rankingContract))throw Error('UNVERIFIED_RANKING_CATALOG')
  await discoverStagingOrderTool(pool)
  return structuredClone(rankingContract)
}
export async function rankOrders({pool,request,statementTimeoutMs}){
  const error=code=>({status:'ERROR',code,result:null})
  const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v
  const p=request?.parameters
  if(!request||Object.keys(request).sort().join(',')!=='catalog_release,dimension_refs,parameters,tool_id,value_refs'
    ||request.tool_id!==rankingContract.id||request.catalog_release!==RANKING_RELEASE
    ||!isDeepStrictEqual(request.value_refs,rankingContract.value_refs)||!isDeepStrictEqual(request.dimension_refs,rankingContract.dimension_refs)
    ||!p||Object.keys(p).sort().join(',')!=='from,source_id,to'||p.source_id!=='medusa-reference'
    ||!iso(p.from)||!iso(p.to)||p.from>=p.to||Date.parse(p.to)-Date.parse(p.from)>90*86400000
    ||!Number.isSafeInteger(statementTimeoutMs)||statementTimeoutMs<=0)return error('INVALID_TOOL_REQUEST')
  try{if(!await discoverRankingTool(pool))return error('UNVERIFIED_RANKING_CATALOG')}catch{return error('UNVERIFIED_CATALOG_OR_BINDING')}
  const provenance={parameters:{...p},implementation_version:'order-ranking-staged-v1',metadata_status:'DRAFT',
    asset_ref:'asset.fact_order',binding_ref:rankingContract.binding,grain:[...rankingContract.grain],time_basis:rankingContract.time_basis,
    interval:'[from,to)',warnings:['DRAFT_METADATA_NOT_RUNTIME_PUBLISHED','FEED_COMPLETENESS_FRESHNESS_RECONCILIATION_UNVERIFIED','PLACED_ORDER_VALUE_NOT_PAID_REVENUE']}
  const semantic_context={tool_id:rankingContract.id,tool_contract_version:'1.0.0',catalog_release:RANKING_RELEASE,
    catalog_status:'VALIDATED_STAGING',value_refs:rankingContract.value_refs,dimension_refs:rankingContract.dimension_refs}
  let client
  try{
    client=await pool.connect()
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY')
    await client.query("SELECT set_config('statement_timeout',$1,true)",[String(statementTimeoutMs)])
    const {rows:[gate]}=await client.query(`SELECT count(*) FILTER(WHERE quality_state<>'VALID')::text AS blocked,
      transaction_timestamp() AS snapshot_at FROM public.analytical_fact_order_v1 WHERE source_id=$1`,[p.source_id])
    provenance.snapshot_at=gate.snapshot_at
    if(gate.blocked!=='0')return {status:'BLOCKED_BY_QUALITY',quality_state:'INVALID',blocked_order_count:gate.blocked,result:null,provenance,semantic_context}
    const {rows:orders}=await client.query(`WITH ranked AS (
      SELECT order_id,currency_code,total_amount::text AS gross_order_value,order_placed_at,canonical_event_ids,
        row_number() OVER(PARTITION BY currency_code ORDER BY total_amount DESC,order_id ASC) AS position
      FROM public.analytical_fact_order_v1 WHERE source_id=$1 AND order_placed_at >= $2::timestamptz AND order_placed_at < $3::timestamptz
    ) SELECT * FROM ranked WHERE position<=5 ORDER BY currency_code,position LIMIT 1001`,[p.source_id,p.from,p.to])
    if(orders.length>1000)return {...error('RESULT_BUDGET_EXCEEDED'),provenance,semantic_context}
    return {status:orders.length?'PROVISIONAL':'INSUFFICIENT_DATA',quality_state:'PROVISIONAL',
      result:{groups:[],orders,limit_per_currency:5},provenance,semantic_context}
  }catch{return {...error('ORDER_RANKING_EXECUTION_FAILED'),provenance,semantic_context}}
  finally{if(client){try{await client.query('ROLLBACK')}finally{client.release()}}}
}
