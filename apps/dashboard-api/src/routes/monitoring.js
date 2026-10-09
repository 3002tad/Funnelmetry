import { Router } from 'express'
import { query, transaction } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireLivePermission } from '../middleware/live-permission.js'
import { requireLiveSession } from '../middleware/live-session.js'
import { monitoringMetrics } from '../lib/monitoring-metrics.js'
import { kafkaLag } from '../lib/kafka-lag.js'
import { workerReadiness } from '../lib/worker-readiness.js'
import { credentialIdPattern, newMonitoringToken, parseMonitoringIssue, verifyMonitoringToken } from '../lib/monitoring-credentials.js'

// Mounted before user-session middleware. Exact path, machine token only.
export function createMachineMonitoringRouter({ execute = query, lag = kafkaLag, workers = workerReadiness } = {}) {
  const router = Router()
  router.all('/api/monitoring/metrics', async (req, res) => {
    res.set('Cache-Control', 'no-store')
    if (req.method !== 'GET') return res.status(405).set('Allow', 'GET').end()
    if (Object.keys(req.query).length) return res.status(400).json({ error: 'invalid_metrics_query' })
    try {
      if (!await verifyMonitoringToken(req.headers.authorization, execute)) return res.status(401).json({ error: 'invalid_monitoring_credential' })
      const [k, w] = await Promise.all([lag(), workers()])
      // Recheck after slow probes so a revoked/expired token cannot receive the result.
      if (!await verifyMonitoringToken(req.headers.authorization, execute)) return res.status(401).json({ error: 'invalid_monitoring_credential' })
      return res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8').send(monitoringMetrics(k, w))
    } catch { return res.status(503).json({ error: 'monitoring_unavailable' }) }
  })
  return router
}

export function createMonitoringCredentialRouter({ execute = query, transact = transaction,
  maxSeconds = Number(process.env.MONITORING_CREDENTIAL_MAX_TTL_SECONDS || 604800) } = {}) {
  if (!Number.isSafeInteger(maxSeconds) || maxSeconds < 60 || maxSeconds > 31536000) throw Error('invalid_monitoring_ttl_policy')
  const router = Router()
  const path = '/api/v2/admin/monitoring-credentials'
  const guards = [requireAuth, requireLiveSession(execute), requireLivePermission('user.manage', execute), requireLivePermission('pipeline.monitor', execute)]
  router.use(path, (_req, res, next) => { res.set('Cache-Control', 'no-store'); next() })
  // Lock the issuer row and recheck active session/role inside each mutation.
  const authorize = async (run, user) => {
    const [row] = await run(`SELECT id FROM dashboard_users WHERE id=$1
      AND is_active=true AND role='super_admin' AND session_version=$2 FOR SHARE`, [user.id, user.session_version])
    if (!row) throw Error('issuer_not_authorized')
  }
  router.get(path, ...guards, async (req, res) => {
    if (Object.keys(req.query).length) return res.status(400).json({ error: 'invalid_query' })
    try {
      const items = await execute(`SELECT id,label,created_by,created_at,expires_at,revoked_at,
        CASE WHEN revoked_at IS NOT NULL THEN 'REVOKED'
             WHEN expires_at <= clock_timestamp() THEN 'EXPIRED' ELSE 'ACTIVE' END AS status
        FROM monitoring_credentials ORDER BY created_at DESC, id DESC LIMIT 200`)
      return res.json({ items, limit: 200 })
    } catch { return res.status(503).json({ error: 'monitoring_credentials_unavailable' }) }
  })
  router.post(path, ...guards, async (req, res) => {
    let input
    try { input = parseMonitoringIssue(req.body, maxSeconds) }
    catch { return res.status(400).json({ error: 'invalid_monitoring_credential', max_ttl_seconds: maxSeconds }) }
    if (Object.keys(req.query).length) return res.status(400).json({ error: 'invalid_query' })
    const credential = newMonitoringToken()
    try {
      const result = await transact(async run => {
        await authorize(run, req.user)
        const [row] = await run(`INSERT INTO monitoring_credentials(id,label,secret_hash,created_by,expires_at)
          VALUES ($1,$2,$3,$4,clock_timestamp()+$5*interval '1 second') RETURNING id,label,expires_at`,
        [credential.id, input.label, credential.hash, req.user.id, input.ttl_seconds])
        await run(`INSERT INTO monitoring_credential_audit(credential_id,actor_id,action) VALUES ($1,$2,'issued')`, [credential.id, req.user.id])
        return row
      })
      return res.status(201).json({ ...result, token: credential.token, capability: 'metrics.read' })
    } catch { return res.status(503).json({ error: 'monitoring_credential_issue_failed' }) }
  })
  router.delete(`${path}/:id`, ...guards, async (req, res) => {
    if (!credentialIdPattern.test(req.params.id) || Object.keys(req.query).length) return res.status(400).json({ error: 'invalid_credential_id' })
    try {
      const found = await transact(async run => {
        await authorize(run, req.user)
        const [row] = await run('SELECT id,revoked_at FROM monitoring_credentials WHERE id=$1 FOR UPDATE', [req.params.id])
        if (!row) return false
        if (!row.revoked_at) {
          await run('UPDATE monitoring_credentials SET revoked_at=clock_timestamp() WHERE id=$1', [req.params.id])
          await run(`INSERT INTO monitoring_credential_audit(credential_id,actor_id,action) VALUES ($1,$2,'revoked')`, [req.params.id, req.user.id])
        }
        return true
      })
      return found ? res.status(204).end() : res.status(404).json({ error: 'credential_not_found' })
    } catch { return res.status(503).json({ error: 'monitoring_credential_revoke_failed' }) }
  })
  return router
}
