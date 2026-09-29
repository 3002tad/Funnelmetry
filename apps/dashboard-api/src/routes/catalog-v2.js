import { Router } from 'express'
import { query, analyticalPool } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireLiveSession } from '../middleware/live-session.js'
import { requireLivePermission } from '../middleware/live-permission.js'

async function loadCatalog() {
  const { inspectStagingOrderCatalog } = await import('../../../../analytics/src/semantic-registry.mjs')
  return inspectStagingOrderCatalog(analyticalPool)
}

// Read-only catalog inspection. Does not enable AI or publish metadata.
export function createCatalogV2Router({ execute = query, load = loadCatalog } = {}) {
  const router = Router()
  router.get('/api/v2/catalog', requireAuth, requireLiveSession(execute), requireLivePermission('analytics.read', execute), async (req, res) => {
    res.set('Cache-Control', 'no-store')
    if (Object.keys(req.query).length) return res.status(400).json({ error: 'invalid_catalog_query' })
    try { return res.json(await load()) }
    catch { return res.status(503).json({ error: 'catalog_unavailable', status: 'UNVERIFIED' }) }
  })
  return router
}
