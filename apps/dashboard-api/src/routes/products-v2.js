import { Router } from 'express'
import { query, readOnlyTransaction } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireLiveSession } from '../middleware/live-session.js'
import { requireLivePermission } from '../middleware/live-permission.js'
import { parseV2AnalyticsQuery } from '../lib/v2-analytics-query.js'
import { attachProductReferences } from '../lib/product-reference.js'

export const productObservationContract = {
  id: 'product-event-observations', version: '1.0.0', status: 'PROVISIONAL',
  grain: 'source_id × product_id × time_window', input_grain: 'canonical_event_id',
  binding: 'canonical_events', time_basis: 'occurred_at',
  measures: { views: 'count of behavior.product_viewed events', adds: 'count of cart.item_added BUSINESS_FACT events' },
  limitations: ['Event counts are not unique people or units.', 'No product revenue, conversion attribution or paid amount.',
    'Product titles, when available, are current descriptive reference, not historical event attributes.', 'Catalog completeness/freshness and feed completeness/freshness are unverified.',
    'Only events with non-empty string product_id are grouped. This is not a published semantic catalog release.'],
}
export function createProductsV2Router({execute=query,readOnly=readOnlyTransaction}={}) {
  const router=Router()
  router.get('/api/v2/products',requireAuth,requireLiveSession(execute),requireLivePermission('analytics.read',execute),async(req,res)=>{
    res.set('Cache-Control','no-store')
    let scope,offset,sort,product
    try {
      if(Object.keys(req.query).some(key=>!['source_id','from','to','offset','sort','product_id'].includes(key)))throw Error()
      scope=parseV2AnalyticsQuery(req.query)
      if(!scope.from||!scope.to||Date.parse(scope.to)-Date.parse(scope.from)>90*86400000)throw Error()
      if(req.query.offset!==undefined && (typeof req.query.offset!=='string'||!/^\d{1,5}$/.test(req.query.offset)))throw Error()
      offset=Number(req.query.offset??0);if(offset>10000)throw Error()
      sort=req.query.sort??'views';if(!['views','adds','product_id'].includes(sort))throw Error()
      product=req.query.product_id??null;if(product!==null&&(typeof product!=='string'||!product.trim()||product.length>200))throw Error()
    }catch{return res.status(400).json({error:'invalid_products_query'})}
    const previousFrom=new Date(2*Date.parse(scope.from)-Date.parse(scope.to)).toISOString()
    try {
      const rows=await readOnly(async tx=>{
        const observations=await tx(`WITH grouped AS (
        SELECT data->>'product_id' AS product_id,
          count(*) FILTER (WHERE occurred_at >= $2 AND event_type='behavior.product_viewed') AS views,
          count(*) FILTER (WHERE occurred_at >= $2 AND event_type='cart.item_added') AS adds,
          count(*) FILTER (WHERE occurred_at < $2 AND event_type='behavior.product_viewed') AS previous_views,
          count(*) FILTER (WHERE occurred_at < $2 AND event_type='cart.item_added') AS previous_adds,
          max(occurred_at) FILTER (WHERE occurred_at >= $2) AS last_seen
        FROM canonical_events WHERE source_id=$1 AND occurred_at >= $4 AND occurred_at < $3
          AND (event_type='behavior.product_viewed' OR (event_type='cart.item_added' AND event_class='BUSINESS_FACT'))
          AND jsonb_typeof(data->'product_id')='string' AND length(trim(data->>'product_id'))>0
          AND ($5::text IS NULL OR data->>'product_id'=$5)
        GROUP BY data->>'product_id'
      ) SELECT * FROM grouped ORDER BY ${sort==='product_id'?'product_id ASC':`${sort} DESC,product_id ASC`} LIMIT 51 OFFSET $6`,
      [scope.sourceId,scope.from,scope.to,previousFrom,product,offset])
        return attachProductReferences(tx,scope.sourceId,observations)
      })
      return res.json({contract:productObservationContract,scope:{...scope,previous_from:previousFrom,previous_to:scope.from},
        items:rows.slice(0,50),next_offset:rows.length>50?offset+50:null,checked_at:new Date().toISOString()})
    }catch{return res.status(503).json({error:'product_observations_unavailable'})}
  })
  return router
}
