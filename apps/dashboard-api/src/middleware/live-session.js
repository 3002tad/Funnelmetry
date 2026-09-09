import { query } from '../db.js'

export function requireLiveSession(execute = query) {
  return async (req, res, next) => {
    if (!req.user || !Number.isInteger(req.user.session_version)) {
      return res.status(401).json({ error: 'session_expired' })
    }
    try {
      const [user] = await execute(
        'SELECT role, is_active, session_version FROM dashboard_users WHERE id = $1', [req.user.id])
      if (!user?.is_active || user.session_version !== req.user.session_version) {
        return res.status(401).json({ error: 'session_expired' })
      }
      req.user.role = user.role
      return next()
    } catch {
      return res.status(503).json({ error: 'authorization_unavailable' })
    }
  }
}
