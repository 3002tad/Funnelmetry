import { query } from '../db.js'
import { hasPermission } from '../lib/roles.js'

// Admin mutations must not trust a stale role in a still-valid JWT.
export function requireLivePermission(permission, execute = query) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'unauthorized' })
    try {
      const [user] = await execute('SELECT role, is_active FROM dashboard_users WHERE id = $1', [req.user.id])
      if (!user?.is_active) return res.status(401).json({ error: 'inactive_account' })
      if (!hasPermission(user.role, permission)) return res.status(403).json({ error: 'forbidden' })
      req.user.role = user.role
      next()
    } catch {
      return res.status(503).json({ error: 'authorization_unavailable' })
    }
  }
}
