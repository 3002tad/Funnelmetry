import { Router } from 'express'
import { query, transaction } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireLiveSession } from '../middleware/live-session.js'
import { requireLivePermission } from '../middleware/live-permission.js'
import { TRAFFIC_SOURCE_LABELS_SQL, parseMappingMutation, parseRawSource,
  parseRegistryLabel, parseRegistrySource, rawSourceHash, saveTrafficMapping } from '../lib/traffic-source-registry.js'

const path = '/api/v2/analytics/traffic-source-registry'
const lookupSql = `SELECT canonical_label, version, updated_at FROM traffic_source_registry_v1
  WHERE source_id=$1 AND raw_utm_source_hash=$2`

export function createTrafficSourceRegistryRouter({ execute = query, run = transaction } = {}) {
  const router = Router()
  const read = [requireAuth, requireLiveSession(execute), requireLivePermission('analytics.read', execute)]
  const write = [requireAuth, requireLiveSession(execute), requireLivePermission('traffic.mapping.write', execute)]

  router.get(path, ...read, async (req, res) => {
    res.set('Cache-Control', 'no-store')
    let sourceId, afterLabel
    try {
      if (Object.keys(req.query).some(key => !['source_id', 'after_label'].includes(key))) throw Error()
      sourceId = parseRegistrySource(req.query.source_id)
      afterLabel = req.query.after_label === undefined ? null : parseRegistryLabel(req.query.after_label)
    } catch { return res.status(400).json({ error: 'invalid_traffic_registry_query' }) }
    try {
      const rows = await execute(TRAFFIC_SOURCE_LABELS_SQL, [sourceId, afterLabel])
      const labels = rows.slice(0, 25)
      const result = { source_id: sourceId, labels, next_after: rows.length > 25 ? labels.at(-1).canonical_label : null,
        raw_values_exposed: false,
        scope: 'current_mapping_only', checked_at: new Date().toISOString() }
      return requireLiveSession(execute)(req, res, () =>
        requireLivePermission('analytics.read', execute)(req, res, () => res.json(result)))
    } catch { return res.status(503).json({ error: 'traffic_registry_unavailable' }) }
  })

  // POST avoids putting an exact raw UTM value in URL/query logs. It is a
  // read-only lookup, never an implicit create/update.
  router.post(`${path}/lookup`, ...write, async (req, res) => {
    res.set('Cache-Control', 'no-store')
    let sourceId, hash
    try {
      if (!req.body || Array.isArray(req.body) || Object.keys(req.body).sort().join(',') !== 'raw_utm_source,source_id') throw Error()
      sourceId = parseRegistrySource(req.body.source_id)
      hash = rawSourceHash(parseRawSource(req.body.raw_utm_source))
    } catch { return res.status(400).json({ error: 'invalid_traffic_registry_lookup' }) }
    try {
      const [row] = await execute(lookupSql, [sourceId, hash])
      const result = { source_id: sourceId, found: Boolean(row),
        canonical_label: row?.canonical_label ?? null, version: row?.version ?? null,
        updated_at: row?.updated_at ?? null }
      return requireLiveSession(execute)(req, res, () =>
        requireLivePermission('traffic.mapping.write', execute)(req, res, () => res.json(result)))
    } catch { return res.status(503).json({ error: 'traffic_registry_unavailable' }) }
  })

  router.post(path, ...write, async (req, res) => {
    res.set('Cache-Control', 'no-store')
    let input
    try {
      if (Object.keys(req.query).length) throw Error()
      input = parseMappingMutation(req.body)
    } catch { return res.status(400).json({ error: 'invalid_traffic_mapping' }) }
    try {
      const saved = await saveTrafficMapping(input, req.user, run)
      return res.status(saved.changed && saved.version === 1 ? 201 : 200).json({
        source_id: input.sourceId, canonical_label: saved.canonical_label,
        version: saved.version, updated_at: saved.updated_at, changed: saved.changed,
        raw_values_exposed: false,
      })
    } catch (error) {
      if ([401, 403, 404, 409].includes(error.status)) return res.status(error.status).json({ error: error.message })
      return res.status(503).json({ error: 'traffic_mapping_unavailable' })
    }
  })

  return router
}
