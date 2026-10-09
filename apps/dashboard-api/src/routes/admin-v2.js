import { Router } from 'express'
import { query } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireLivePermission } from '../middleware/live-permission.js'
import { ROLE_PERMISSIONS } from '../lib/roles.js'
import { listAccountAudit, parseAuditQuery } from '../lib/account-audit.js'
import { listObservedSources, parseSourcesQuery } from '../lib/admin-sources.js'
import { connectorReadiness } from '../lib/connector-readiness.js'
import { requireLiveSession } from '../middleware/live-session.js'
import { PROCESSING_OBSERVATION_SQL, parseProcessingSource } from '../lib/processing-observation.js'
import { kafkaLag } from '../lib/kafka-lag.js'
import { workerReadiness } from '../lib/worker-readiness.js'
import { monitoringMetrics } from '../lib/monitoring-metrics.js'

export function createAdminV2Router(execute = query, probe = connectorReadiness, probeLag = kafkaLag, probeWorkers = workerReadiness) {
  const router = Router()
  router.get('/api/v2/admin/metrics', requireAuth, requireLiveSession(execute),
    requireLivePermission('pipeline.monitor', execute), async (req, res) => {
      res.set('Cache-Control', 'no-store')
      if (Object.keys(req.query).length) return res.status(400).json({ error: 'invalid_metrics_query' })
      try {
        const [lag, workers] = await Promise.all([probeLag(), probeWorkers()])
        const output = monitoringMetrics(lag, workers)
        return requireLiveSession(execute)(req, res, () =>
          requireLivePermission('pipeline.monitor', execute)(req, res, () =>
            res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8').send(output)))
      } catch { return res.status(503).json({ error: 'monitoring_metrics_unavailable' }) }
    })
  router.get('/api/v2/admin/worker-readiness', requireAuth, requireLiveSession(execute),
    requireLivePermission('pipeline.monitor', execute), async (req, res) => {
      res.set('Cache-Control', 'no-store')
      if (Object.keys(req.query).length) return res.status(400).json({ error: 'invalid_worker_readiness_query' })
      try {
        const result = await probeWorkers()
        return requireLiveSession(execute)(req, res, () =>
          requireLivePermission('pipeline.monitor', execute)(req, res, () => res.json(result)))
      } catch { return res.status(503).json({ error: 'worker_readiness_unavailable' }) }
    })
  router.get('/api/v2/admin/kafka-lag', requireAuth, requireLiveSession(execute),
    requireLivePermission('pipeline.monitor', execute), async (req, res) => {
      res.set('Cache-Control', 'no-store')
      if (Object.keys(req.query).length) return res.status(400).json({ error: 'invalid_kafka_lag_query' })
      try {
        const result = await probeLag()
        return requireLiveSession(execute)(req, res, () =>
          requireLivePermission('pipeline.monitor', execute)(req, res, () => res.json(result)))
      } catch { return res.status(503).json({ error: 'kafka_lag_unavailable' }) }
    })
  router.get('/api/v2/admin/processing', requireAuth, requireLiveSession(execute),
    requireLivePermission('pipeline.monitor', execute), async (req, res) => {
      res.set('Cache-Control', 'no-store')
      let source
      try { source = parseProcessingSource(req.query) }
      catch { return res.status(400).json({ error: 'invalid_processing_query' }) }
      try {
        const observation_started_at = new Date().toISOString()
        const rows = await execute(PROCESSING_OBSERVATION_SQL, [source])
        const snapshot = {
          source_id: source, observation_started_at, checked_at: new Date().toISOString(),
          scope: 'retained_postgres_records', runtime_status: 'UNVERIFIED',
          kafka_consumer_lag: null, kafka_lag_status: 'UNVERIFIED',
          stages: rows.map(({ stage, retained_count, last_processed_at, last_recorded_at }) =>
            ({ stage, retained_count, last_processed_at, last_recorded_at })),
        }
        return requireLiveSession(execute)(req, res, () =>
          requireLivePermission('pipeline.monitor', execute)(req, res, () => res.json(snapshot)))
      } catch { return res.status(503).json({ error: 'processing_observation_unavailable' }) }
    })
  router.get('/api/v2/admin/event-feed', requireAuth, requireLiveSession(execute),
    requireLivePermission('pipeline.monitor', execute), async (req, res) => {
      res.set('Cache-Control', 'no-store')
      if (Object.keys(req.query).length) return res.status(400).json({ error: 'invalid_event_feed_query' })
      try {
        const result = await probe()
        const snapshot = {
          checked_at: result.checked_at, reachable: result.reachable,
          ready: result.ready, status: result.status,
          last_success_at: result.last_success_at,
          observation: result.feed_observation ?? null,
          scope: 'last_validated_feed_response', processing_checkpoint_available: false,
        }
        return requireLiveSession(execute)(req, res, () =>
          requireLivePermission('pipeline.monitor', execute)(req, res, () => res.json(snapshot)))
      } catch { return res.status(503).json({ error: 'event_feed_observation_unavailable' }) }
    })
  router.get('/api/v2/admin/quarantine',requireAuth,requireLivePermission('pipeline.monitor',execute),async(req,res)=>{
    res.set('Cache-Control','no-store')
    const {source_id,status,offset='0'}=req.query
    if(Object.keys(req.query).some(k=>!['source_id','status','offset'].includes(k)) || typeof source_id!=='string'||!source_id.trim()||source_id.length>200
      || (status!==undefined&&!['quarantined','unsupported'].includes(status)) || typeof offset!=='string'||!/^\d+$/.test(offset)||Number(offset)>10000) return res.status(400).json({error:'invalid_quarantine_query'})
    try{
      const rows=await execute(`SELECT source_id,source_event_id,mapping_version,status,reason_code,processed_at
        FROM canonicalization_latest_outcomes WHERE source_id=$1 AND status IN ('quarantined','unsupported')
        AND ($2::text IS NULL OR status=$2) ORDER BY processed_at DESC,source_event_id LIMIT 26 OFFSET $3`,[source_id.trim(),status??null,Number(offset)])
      return res.json({items:rows.slice(0,25),next_offset:rows.length>25&&Number(offset)<10000?Number(offset)+25:null,checked_at:new Date().toISOString(),scope:'latest_canonicalization_outcome',replay_available:false})
    }catch{return res.status(503).json({error:'quarantine_unavailable'})}
  })
  router.get('/api/v2/admin/connector-readiness',requireAuth,requireLivePermission('pipeline.monitor',execute),async(req,res)=>{
    res.set('Cache-Control','no-store')
    if(Object.keys(req.query).length)return res.status(400).json({error:'invalid_readiness_query'})
    try{return res.json(await probe())}catch{return res.status(503).json({error:'connector_probe_unavailable'})}
  })
  router.get('/api/v2/admin/connectors', requireAuth, requireLivePermission('pipeline.monitor', execute), async(req,res)=>{
    res.set('Cache-Control','no-store')
    const {connector_id,after}=req.query
    if(Object.keys(req.query).some(k=>!['connector_id','after'].includes(k)) || [connector_id,after].some(v=>v!==undefined&&(typeof v!=='string'||!v.trim()||v.length>200))) return res.status(400).json({error:'invalid_connector_query'})
    try {
      const rows=await execute(`SELECT connector_id,event_feed_id,after_seq::text AS after_seq,updated_at
        FROM source_connector_cursors WHERE ($1::text IS NULL OR connector_id=$1)
        AND ($2::text IS NULL OR connector_id>$2) ORDER BY connector_id LIMIT 26`,[connector_id??null,after??null])
      const items=rows.slice(0,25)
      return res.json({items,next_after:rows.length>25?items.at(-1).connector_id:null,checked_at:new Date().toISOString(),runtime_status:'UNVERIFIED',scope:'persisted_kafka_handoff_cursor'})
    } catch {return res.status(503).json({error:'connector_state_unavailable'})}
  })
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
