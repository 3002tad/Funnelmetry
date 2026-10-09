import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireLiveSession } from '../middleware/live-session.js'
import { requireLivePermission } from '../middleware/live-permission.js'
import { workerReadiness } from '../lib/worker-readiness.js'
import { alertPolicy, scrapeObservation, monitoringAlerts } from '../lib/monitoring-alerts.js'

export function createMonitoringAlertsRouter({ execute = query, workers = workerReadiness, scrape = scrapeObservation, policy = alertPolicy() } = {}) {
  const router = Router()
  router.get('/api/v2/admin/monitoring-alerts', requireAuth, requireLiveSession(execute), requireLivePermission('pipeline.monitor', execute), async (req,res) => {
    res.set('Cache-Control','no-store')
    if (Object.keys(req.query).length) return res.status(400).json({error:'invalid_alert_query'})
    try {
      const [w,s,credentials] = await Promise.all([
        workers().catch(() => ({workers:[]})), scrape().catch(() => ({state:'UNKNOWN',reason:'PROMETHEUS_UNAVAILABLE'})),
        execute(`SELECT c.id,c.expires_at FROM monitoring_credentials c JOIN dashboard_users u ON u.id=c.created_by
          WHERE c.revoked_at IS NULL AND u.is_active=true AND u.role='super_admin'
          ORDER BY c.expires_at ASC LIMIT 200`).catch(() => null),
      ])
      const result = monitoringAlerts({workers:w,scrape:s,credentials,policy})
      return requireLiveSession(execute)(req,res,() => requireLivePermission('pipeline.monitor',execute)(req,res,() => res.json(result)))
    } catch { return res.status(503).json({error:'monitoring_alerts_unavailable'}) }
  })
  return router
}
