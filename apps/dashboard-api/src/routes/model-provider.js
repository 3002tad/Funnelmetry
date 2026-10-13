import { Router } from 'express'
import { query } from '../db.js'
import { loadDashScopeConfig } from '../lib/ai/dashscope.js'
import { requireAuth } from '../middleware/auth.js'
import { requireLiveSession } from '../middleware/live-session.js'
import { requireLivePermission } from '../middleware/live-permission.js'

const diagnosticCodes = new Set([
  'invalid_qwen_flag', 'invalid_dashscope_endpoint',
  'missing_or_invalid_dashscope_key', 'invalid_dashscope_timeout',
])

// Inspect local runtime configuration only. Never return the endpoint, key, or
// raw exception; a valid configuration does not prove upstream availability.
export function inspectModelProvider(env = process.env) {
  const base = { provider_id: 'alibaba-cloud-model-studio', model_id: 'qwen-flash',
    region: 'singapore', external_probe: false, read_only: true }
  try {
    const config = loadDashScopeConfig(env)
    return { ...base, configuration_state: config ? 'CONFIGURED' : 'DISABLED', diagnostic_code: null }
  } catch (error) {
    return { ...base, configuration_state: 'INVALID',
      diagnostic_code: diagnosticCodes.has(error?.code) ? error.code : 'UNVERIFIED_CONFIGURATION' }
  }
}

export function createModelProviderRouter({ execute = query, env = process.env } = {}) {
  const router = Router()
  router.get('/api/v2/admin/model-provider', requireAuth, requireLiveSession(execute),
    requireLivePermission('pipeline.monitor', execute), (req, res) => {
      res.set('Cache-Control', 'no-store')
      if (Object.keys(req.query).length) return res.status(400).json({ error: 'invalid_model_provider_query' })
      const snapshot = { ...inspectModelProvider(env), checked_at: new Date().toISOString() }
      return requireLiveSession(execute)(req, res, () => requireLivePermission('pipeline.monitor', execute)(req, res,
        () => res.json(snapshot)))
    })
  return router
}
