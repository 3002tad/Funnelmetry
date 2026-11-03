import { Router } from 'express'
import { requireAuth } from '../middleware/auth.js'
import { requireLiveSession } from '../middleware/live-session.js'

// This endpoint verifies a Pipeline bearer session; callers must not forward
// browser-supplied identity headers as proof of identity to DB-GPT.
export function createAiIdentityRouter({ execute } = {}) {
  const router = Router()
  router.get('/api/auth/ai-identity', requireAuth, requireLiveSession(execute), (req, res) => {
    res.set('Cache-Control', 'no-store')
    if (req.user.role !== 'super_admin' && req.user.role !== 'analyst') {
      return res.status(403).json({ error: 'ai_role_not_supported' })
    }
    return res.json({ actor: { id: req.user.id, role: req.user.role } })
  })
  return router
}
