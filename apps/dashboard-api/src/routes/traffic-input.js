import { Router } from 'express'
import { query, readOnlyTransaction } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireLiveSession } from '../middleware/live-session.js'
import { requireLivePermission } from '../middleware/live-permission.js'
import { parseV2AnalyticsQuery } from '../lib/v2-analytics-query.js'

// This is acquisition observability, not a traffic/channel analytical asset.
// The row grain is one browser event in the retained Raw Kafka projection.
export const trafficInputContract = Object.freeze({
  id: 'traffic-utm-source-input-observation', version: '1.0.0', status: 'PROVISIONAL',
  grain: 'source_id × received_at_window', input_grain: 'source_id × source_event_id',
  binding: 'traffic_source_raw_events_v1', time_basis: 'received_at',
  limitations: [
    'Counts only browser events projected from retained Raw Kafka; historical and feed coverage are unverified.',
    'Counts are events, not visitors, sessions, orders, or attributed conversions.',
    'PRESENT means utm_source was a string; no channel normalization or campaign attribution is applied.',
    'Synthetic events are included and counted separately.',
  ],
})

export const TRAFFIC_INPUT_SUMMARY_SQL = `SELECT
  COUNT(*)::text AS observed_events,
  COUNT(*) FILTER (WHERE utm_source_state = 'PRESENT')::text AS present_events,
  COUNT(*) FILTER (WHERE utm_source_state = 'ABSENT')::text AS absent_events,
  COUNT(*) FILTER (WHERE utm_source_state = 'INVALID')::text AS invalid_events,
  COUNT(*) FILTER (WHERE synthetic)::text AS synthetic_events,
  MAX(received_at) AS latest_received_at
FROM traffic_source_raw_events_v1
WHERE source_id = $1 AND received_at >= $2::timestamptz AND received_at < $3::timestamptz`

export const TRAFFIC_INPUT_BREAKDOWN_SQL = `SELECT r.canonical_label,
  COUNT(*)::text AS event_count
  FROM traffic_source_raw_events_v1 t
  LEFT JOIN traffic_source_registry_v1 r
    ON r.source_id=t.source_id AND r.raw_utm_source_hash=t.utm_source_hash
  WHERE t.source_id=$1 AND t.received_at >= $2::timestamptz
    AND t.received_at < $3::timestamptz AND t.utm_source_state='PRESENT'
  GROUP BY r.canonical_label ORDER BY COUNT(*) DESC, r.canonical_label ASC NULLS LAST LIMIT 26`

export function createTrafficInputRouter({ execute = query, readOnly = readOnlyTransaction } = {}) {
  const router = Router()
  const read = [requireAuth, requireLiveSession(execute), requireLivePermission('analytics.read', execute)]
  function parseScope(req, res) {
    try {
      if (Object.keys(req.query).some(key => !['source_id', 'from', 'to'].includes(key))) throw Error()
      const scope = parseV2AnalyticsQuery(req.query)
      if (!scope.from || !scope.to || Date.parse(scope.to) - Date.parse(scope.from) > 90 * 86400000) throw Error()
      return scope
    } catch { res.status(400).json({ error: 'invalid_traffic_input_query' }); return null }
  }
  router.get('/api/v2/analytics/traffic-input', ...read, async (req, res) => {
      res.set('Cache-Control', 'no-store')
      const scope = parseScope(req, res)
      if (!scope) return
      try {
        const [row] = await readOnly(run => run(TRAFFIC_INPUT_SUMMARY_SQL, [scope.sourceId, scope.from, scope.to]))
        if (!row) throw Error('missing traffic summary')
        const result = {
          contract: trafficInputContract,
          scope: { source_id: scope.sourceId, from: scope.from, to: scope.to },
          observed_events: row.observed_events,
          present_events: row.present_events,
          absent_events: row.absent_events,
          invalid_events: row.invalid_events,
          synthetic_events: row.synthetic_events,
          latest_received_at: row.latest_received_at,
          historical_coverage_verified: false,
          attribution_verified: false,
          checked_at: new Date().toISOString(),
        }
        return requireLiveSession(execute)(req, res, () =>
          requireLivePermission('analytics.read', execute)(req, res, () => res.json(result)))
      } catch { return res.status(503).json({ error: 'traffic_input_unavailable' }) }
    })
  router.get('/api/v2/analytics/traffic-input/breakdown', ...read, async (req, res) => {
    res.set('Cache-Control', 'no-store')
    const scope = parseScope(req, res)
    if (!scope) return
    try {
      const rows = await readOnly(run => run(TRAFFIC_INPUT_BREAKDOWN_SQL, [scope.sourceId, scope.from, scope.to]))
      const result = { scope: { source_id: scope.sourceId, from: scope.from, to: scope.to },
        items: rows.slice(0, 25), more_labels: rows.length > 25,
        grain: 'source_id × current_mapping_label × received_at_window',
        time_basis: 'received_at', mapping_basis: 'current_registry_v1',
        attribution_verified: false, historical_coverage_verified: false,
        checked_at: new Date().toISOString() }
      return requireLiveSession(execute)(req, res, () =>
        requireLivePermission('analytics.read', execute)(req, res, () => res.json(result)))
    } catch { return res.status(503).json({ error: 'traffic_input_unavailable' }) }
  })
  return router
}
