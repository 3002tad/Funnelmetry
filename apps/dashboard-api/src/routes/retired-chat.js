import { Router } from 'express'

// Mounted after the app's authentication/live-session boundary. Old feature
// flags must not reactivate Pipeline chat after the DB-GPT migration.
export const retiredChatRouter = Router()
retiredChatRouter.use(['/api/chat', '/api/v2/chat'], (_req, res) => {
  res.set('Cache-Control', 'no-store')
  res.status(410).json({ error: 'pipeline_chat_retired', replacement: '/ai' })
})
