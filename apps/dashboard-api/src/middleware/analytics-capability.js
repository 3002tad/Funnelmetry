import { hasPermission } from '../lib/roles.js'

// Staff gets summary reads only; workspace/drill-down APIs require a separate capability.
export function requireAnalyticsCapability(req, res, next) {
  const summary = req.method === 'GET' && (
    req.path === '/api/v2/analytics/overview'
    || /^\/api\/v2\/analytics\/funnels\/[^/]+\/?$/.test(req.path)
  )
  const permission = summary ? 'analytics.read' : 'analytics.workspace.use'
  if (!hasPermission(req.user?.role, permission)) return res.status(403).json({ error: 'forbidden' })
  next()
}
