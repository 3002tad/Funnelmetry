import { Router } from 'express'
import { query, analyticalPool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireLiveSession } from '../middleware/live-session.js'
import { requireLivePermission } from '../middleware/live-permission.js'
import { loadMappingInspection } from '../lib/mapping-inspection.js'

async function loadCatalog() {
  const { inspectStagingOrderCatalog } = await import('../../../../analytics/src/semantic-registry.mjs')
  return inspectStagingOrderCatalog(analyticalPool)
}

export async function loadAdminRegistry(pool = analyticalPool, env = process.env) {
  const { inspectStagingOrderCatalog } = await import('../../../../analytics/src/semantic-registry.mjs')
  const { discoverRankingTool } = await import('../../../../analytics/src/order-ranking.mjs')
  const { discoverProductRankingTool } = await import('../../../../analytics/src/product-ranking.mjs')
  const baseEnabled = env.DASHBOARD_ENABLE_ORDER_SUMMARY_STAGING === 'true' && env.DASHBOARD_ENABLE_ORDER_CHAT_STAGING === 'true'
  const specs = [
    ['tool.metric_summary', () => inspectStagingOrderCatalog(pool), baseEnabled],
    ['tool.order_ranking', () => discoverRankingTool(pool), baseEnabled && env.DASHBOARD_ENABLE_ORDER_RANKING_STAGING === 'true'],
    ['tool.product_value_ranking', () => discoverProductRankingTool(pool), baseEnabled && env.DASHBOARD_ENABLE_PRODUCT_RANKING_STAGING === 'true'],
  ]
  const items = []
  for (const [id, inspect, enabled] of specs) {
    try {
      const document = await inspect()
      items.push({id, verification:document?'VERIFIED':'NOT_INSTALLED', document,
        chat_configured:enabled, provider_enabled:env.DASHBOARD_ENABLE_QWEN==='true'})
    } catch { items.push({id,verification:'UNVERIFIED',document:null,chat_configured:enabled,
      provider_enabled:env.DASHBOARD_ENABLE_QWEN==='true'}) }
  }
  return {checked_at:new Date().toISOString(),scope:'SUPPORTED_STAGING_ANALYTICAL_TOOLS',read_only:true,items}
}

// Read-only catalog inspection. Does not enable AI or publish metadata.
export function createCatalogV2Router({ execute = query, load = loadCatalog, loadAdmin = loadAdminRegistry, loadMappings = loadMappingInspection } = {}) {
  const router = Router()
  router.get('/api/v2/admin/mappings',requireAuth,requireLiveSession(execute),requireLivePermission('integration.read',execute),async(req,res)=>{
    res.set('Cache-Control','no-store')
    if(Object.keys(req.query).length)return res.status(400).json({error:'invalid_mapping_query'})
    try{
      const result=await loadMappings()
      return requireLiveSession(execute)(req,res,()=>requireLivePermission('integration.read',execute)(req,res,()=>res.json(result)))
    }catch{return res.status(503).json({error:'mapping_inspection_unavailable'})}
  })
  router.get('/api/v2/admin/registry', requireAuth, requireLiveSession(execute), requireLivePermission('integration.read', execute), async (req,res) => {
    res.set('Cache-Control','no-store')
    if(Object.keys(req.query).length) return res.status(400).json({error:'invalid_registry_query'})
    try {
      const result=await loadAdmin()
      // Recheck live role/session after registry I/O before disclosing definitions.
      return requireLiveSession(execute)(req,res,()=>requireLivePermission('integration.read',execute)(req,res,()=>res.json(result)))
    } catch { return res.status(503).json({error:'registry_unavailable'}) }
  })
  router.get('/api/v2/catalog', requireAuth, requireLiveSession(execute), requireLivePermission('analytics.read', execute), async (req, res) => {
    res.set('Cache-Control', 'no-store')
    if (Object.keys(req.query).length) return res.status(400).json({ error: 'invalid_catalog_query' })
    try { return res.json(await load()) }
    catch { return res.status(503).json({ error: 'catalog_unavailable', status: 'UNVERIFIED' }) }
  })
  return router
}
