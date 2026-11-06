import { Router } from 'express'
import { query, repeatableReadOnlyTransaction } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireLiveSession } from '../middleware/live-session.js'
import { requireLivePermission } from '../middleware/live-permission.js'
import { parseV2AnalyticsQuery } from '../lib/v2-analytics-query.js'

export const DEMO_DATASETS = ['demo-historical-100000-v2','demo-gap-20261101-20261105-v1','demo-historical-100000-v3-utm','demo-gap-20261101-20261105-v2-utm']
export function parseExplorerQuery(input) {
  const scope=parseV2AnalyticsQuery(input), dataset=input.dataset??'observed'
  if(Object.keys(input).some(k=>!['source_id','from','to','dataset','variant_id'].includes(k))||scope.sourceId!=='medusa-reference'||!scope.from||!scope.to||Date.parse(scope.to)-Date.parse(scope.from)>366*86400000||!['observed',...DEMO_DATASETS].includes(dataset))throw Error('invalid_explorer_query')
  const variant=input.variant_id??null
  if(variant!==null&&(typeof variant!=='string'||!variant.trim()||variant.length>200))throw Error('invalid_variant')
  return {...scope,dataset,variant}
}
export function createDashboardExplorerRouter({execute=query,readOnly=repeatableReadOnlyTransaction}={}) {
  const router=Router()
  router.get('/api/v2/analytics/datasets',requireAuth,requireLiveSession(execute),requireLivePermission('analytics.read',execute),async(req,res)=>{
    res.set('Cache-Control','no-store')
    if(req.query.source_id!=='medusa-reference'||Object.keys(req.query).some(k=>k!=='source_id'))return res.status(400).json({error:'invalid_source'})
    try{const items=await readOnly(sql=>sql(`SELECT dataset_id AS id,min(occurred_at) AS first_event_at,max(occurred_at) AS last_event_at FROM funnelmetry_demo.browser_events GROUP BY dataset_id ORDER BY dataset_id`));return res.json({items:[{id:'observed',origin:'OBSERVED_SOURCE'},...items.filter(d=>DEMO_DATASETS.includes(d.id)).map(d=>({...d,origin:'SYNTHETIC_BACKFILL'}))]})}catch{return res.status(503).json({error:'dataset_catalog_unavailable'})}
  })
  router.get('/api/v2/analytics/explorer',requireAuth,requireLiveSession(execute),requireLivePermission('analytics.read',execute),async(req,res)=>{
    res.set('Cache-Control','no-store');let s;try{s=parseExplorerQuery(req.query)}catch{return res.status(400).json({error:'invalid_explorer_query'})}
    try{const data=await readOnly(async sql=>{
      // Identifiers are fixed code branches. All user values are bound parameters.
      const demo=s.dataset!=='observed', relation=demo?'funnelmetry_demo.browser_events':'canonical_events', identity=demo?'dataset_id':'source_id', payload=demo?'data':'data'
      const args=[demo?s.dataset:s.sourceId,s.from,s.to,s.variant]
      const where=`${identity}=$1 AND occurred_at >= $2::timestamptz AND occurred_at < $3::timestamptz AND ($4::text IS NULL OR ${payload}->>'variant_id'=$4)`
      const daily=await sql(`SELECT to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS date,count(*)::text AS total,count(*) FILTER(WHERE event_type='behavior.product_viewed')::text AS views,count(*) FILTER(WHERE event_type='behavior.search_query_submitted')::text AS searches FROM ${relation} WHERE ${where} GROUP BY 1 ORDER BY 1`,args)
      const event_types=await sql(`SELECT to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS date,event_type,count(*)::text AS total FROM ${relation} WHERE ${where} GROUP BY 1,2 ORDER BY 1,2`,args)
      const carts=demo?await sql(`SELECT to_char(change_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS date,count(*)::text AS cart FROM funnelmetry_demo.cart_changes WHERE dataset_id=$1 AND change_at >= $2::timestamptz AND change_at < $3::timestamptz AND change_type='ADD' AND after_quantity>before_quantity AND ($4::text IS NULL OR variant_key=$4) GROUP BY 1`,args):await sql(`SELECT to_char(occurred_at AT TIME ZONE 'UTC','YYYY-MM-DD') AS date,count(*)::text AS cart FROM canonical_events WHERE ${where} AND event_type='cart.item_added' AND event_class='BUSINESS_FACT' GROUP BY 1`,args)
      const dates=new Map(daily.map(r=>[r.date,{...r,cart:'0'}]));for(const row of carts){const item=dates.get(row.date);if(item)item.cart=row.cart;else dates.set(row.date,{date:row.date,total:'0',views:'0',searches:'0',cart:row.cart})}
      const products=await sql(`SELECT data->>'product_id' AS product_id,count(*)::text AS views FROM ${relation} WHERE ${where} AND event_type='behavior.product_viewed' AND data->>'product_id' IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC,1 LIMIT 20`,args)
      const keywords=await sql(`SELECT data->>'query_normalized' AS keyword,count(*)::text AS submits FROM ${relation} WHERE ${where} AND event_type='behavior.search_query_submitted' AND data->>'query_normalized' IS NOT NULL GROUP BY 1 ORDER BY count(*) DESC,1 LIMIT 20`,args)
      const utm=await sql(`SELECT ${demo?'utm_source':"data->>'utm_source'"} AS source,count(*)::text AS total FROM ${relation} WHERE ${where} GROUP BY 1 ORDER BY count(*) DESC,1 LIMIT 20`,args)
      let counts=null
      if(demo){const [row]=await sql(`SELECT (SELECT count(*)::text FROM funnelmetry_demo.sessions WHERE dataset_id=$1 AND started_at >= $2::timestamptz AND started_at < $3::timestamptz) AS sessions,(SELECT count(*)::text FROM funnelmetry_demo.orders WHERE dataset_id=$1 AND created_at >= $2::timestamptz AND created_at < $3::timestamptz) AS orders,(SELECT count(*)::text FROM funnelmetry_demo.catalog_products WHERE dataset_id=$1) AS catalog_products`,args.slice(0,3));counts=row??null}
      let variants=[],prices=[],coverage=[]
      if(demo){variants=await sql(`SELECT v.variant_id,v.product_id,p.title FROM funnelmetry_demo.catalog_variants v JOIN funnelmetry_demo.catalog_products p ON p.dataset_id=v.dataset_id AND p.product_id=v.product_id WHERE v.dataset_id=$1 ORDER BY p.title,v.variant_id LIMIT 500`,[s.dataset]);coverage=await sql('SELECT domain,status,interval_start,interval_end FROM funnelmetry_demo.coverage WHERE dataset_id=$1 ORDER BY domain',[s.dataset]);if(s.variant)prices=await sql(`SELECT effective_at,valid_to,currency,amount_minor,channel,region,price_rule FROM funnelmetry_demo.offer_prices WHERE dataset_id=$1 AND variant_key=$4 AND effective_at < $3::timestamptz AND (valid_to IS NULL OR valid_to > $2::timestamptz) ORDER BY effective_at`,args)}
      return {daily:[...dates.values()].sort((a,b)=>a.date.localeCompare(b.date)),event_types,counts,utm,products,keywords,variants,prices,coverage}
    });return res.json({source_id:s.sourceId,dataset:s.dataset,origin:s.dataset==='observed'?'OBSERVED_SOURCE':'SYNTHETIC_BACKFILL',quality:'UNVERIFIED',window:{from:s.from,to:s.to,basis:'occurred_at'},contract:{id:'dashboard-exploration-v1',grain:'event × source/dataset × UTC day',official:false,limitations:['Empty buckets are not evidence of zero source activity or complete coverage.','Synthetic data does not certify observed history.','Counts are events, not unique customers or conversions.','Price rows are per variant/currency/channel/region/rule; no effective checkout-price resolution.']},...data})}catch{return res.status(503).json({error:'exploration_unavailable',message:'Không có view/quyền đọc hoặc truy vấn chưa hoàn tất. Không coi đây là dữ liệu bằng 0.'})}
  });return router
}
