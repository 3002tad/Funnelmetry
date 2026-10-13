import { Router } from 'express'
import { query, readOnlyTransaction } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireLiveSession } from '../middleware/live-session.js'
import { requireLivePermission } from '../middleware/live-permission.js'

const statuses = ['PROVISIONAL', 'INSUFFICIENT_DATA', 'BLOCKED_BY_QUALITY', 'ERROR']

export function createAgentObservabilityRouter({ execute = query, readOnly = readOnlyTransaction } = {}) {
  const router = Router()
  router.get('/api/v2/admin/agent-observability', requireAuth, requireLiveSession(execute),
    requireLivePermission('pipeline.monitor', execute), async (req, res) => {
      res.set('Cache-Control', 'no-store')
      if (Object.keys(req.query).length) return res.status(400).json({ error: 'invalid_agent_observability_query' })
      try {
        const snapshot = await readOnly(async tx => {
          const rows = await tx(`SELECT status, COUNT(*)::text AS execution_count,
              MAX(created_at) AS latest_created_at
            FROM analytical_execution_evidence
            WHERE created_at >= now() - interval '30 days'
            GROUP BY status`)
          const counts = Object.fromEntries(statuses.map(status => [status, '0']))
          let latest = null
          for (const row of rows) {
            if (!statuses.includes(row.status) || !/^(0|[1-9][0-9]*)$/.test(row.execution_count)) {
              throw new Error('invalid_execution_summary')
            }
            counts[row.status] = row.execution_count
            if (row.latest_created_at && (!latest || new Date(row.latest_created_at) > new Date(latest))) {
              latest = row.latest_created_at
            }
          }
          return { status_counts: counts, latest_execution_at: latest }
        })
        return requireLiveSession(execute)(req, res, () => requireLivePermission('pipeline.monitor', execute)(req, res,
          () => res.json({ ...snapshot, checked_at: new Date().toISOString(), window_days: 30,
            scope: 'PERSISTED_COMPLETED_ANALYTICAL_TOOL_EXECUTIONS_ONLY', read_only: true })))
      } catch {
        return res.status(503).json({ error: 'agent_observability_unavailable' })
      }
    })
  return router
}
