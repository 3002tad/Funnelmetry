import { Router } from 'express'
import { listRecentInsights } from '../lib/chat/chat.service.js'

export const insightsRouter = Router()
insightsRouter.get('/api/chat/insights', async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 12, 30)
  try { res.json(await listRecentInsights(limit)) }
  catch { res.status(503).json({ error: 'insights_unavailable' }) }
})
