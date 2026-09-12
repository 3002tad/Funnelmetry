import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireLivePermission } from '../middleware/live-permission.js'
import { ROLE_PERMISSIONS } from '../lib/roles.js'
import { listAccountAudit, parseAuditQuery } from '../lib/account-audit.js'
import { listObservedSources, parseSourcesQuery } from '../lib/admin-sources.js'

export function createAdminV2Router(execute = query) {
  const router = Router()
  router.get('/api/v2/admin/sources', requireAuth, requireLivePermission('integration.read', execute), async (req, res) => {
    res.set('Cache-Control', 'no-store')
    let filters
    try { filters = parseSourcesQuery(req.query) }
    catch { return res.status(400).json({ error: 'invalid_sources_query' }) }
    try { return res.json(await listObservedSources(execute, filters)) }
    catch { return res.status(503).json({ error: 'sources_evidence_unavailable' }) }
  })
  router.get('/api/v2/admin/audit', requireAuth, requireLivePermission('audit.read', execute), async (req, res) => {
    let filters
    try { filters = parseAuditQuery(req.query) }
    catch { return res.status(400).json({ error: 'invalid_audit_query' }) }
    try {
      res.set('Cache-Control', 'no-store')
      return res.json(await listAccountAudit(execute, filters))
    } catch { return res.status(503).json({ error: 'audit_unavailable' }) }
  })
  router.get('/api/v2/admin/roles', requireAuth, requireLivePermission('role.manage', execute), (_req, res) => {
    res.json({ roles: Object.entries(ROLE_PERMISSIONS).filter(([role]) => role !== 'viewer')
      .map(([role, permissions]) => ({ role, permissions })), editable_permissions: false })
  })
  router.get('/api/v2/admin/pipeline', requireAuth, requireLivePermission('pipeline.monitor', execute), async (req, res) => {
    const source = req.query.source_id
    if (typeof source !== 'string' || !source.trim() || source.length > 200) {
      return res.status(400).json({ error: 'source_id_required' })
    }
    try {
      const [metrics] = await execute(`SELECT
        (SELECT COUNT(*)::int FROM ingress_accepted_receipts WHERE source_id=$1) AS accepted,
        (SELECT COUNT(*)::int FROM canonicalization_latest_outcomes WHERE source_id=$1) AS terminal,
        (SELECT COUNT(*)::int FROM canonical_events WHERE source_id=$1) AS canonical,
        (SELECT MAX(persisted_at) FROM canonical_events WHERE source_id=$1) AS last_canonical_at,
        (SELECT COUNT(*)::int FROM kpi_projection_applications WHERE source_id=$1) AS kpi_applications,
        (SELECT MAX(applied_at) FROM kpi_projection_applications WHERE source_id=$1) AS last_kpi_at,
        (SELECT COUNT(*)::int FROM ingress_receipt_claims WHERE source_id=$1 AND claim_state='CLAIMED') AS pending_claims`, [source.trim()])
      res.json({ source_id: source.trim(), checked_at: new Date().toISOString(),
        evidence: 'postgres_v2', scope: 'retained_records', runtime_status: 'UNVERIFIED', metrics,
        unavailable: ['Kafka consumer lag', 'Worker liveness', 'End-to-end delivery guarantee'] })
    } catch {
      res.status(503).json({ error: 'pipeline_evidence_unavailable' })
    }
  })
  return router
}
