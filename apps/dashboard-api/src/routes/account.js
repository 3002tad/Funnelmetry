import { Router } from 'express'
import { query, transaction } from '../db.js'
import { requireAuth } from '../middleware/auth.js'
import { requireLiveSession } from '../middleware/live-session.js'
import { DEFAULT_PREFERENCES, parsePreferencesPatch } from '../lib/account-preferences.js'
import { listAccountAudit, parseAuditQuery } from '../lib/account-audit.js'
import { accountError } from '../lib/account-mutation.js'

export const accountRouter = Router()
accountRouter.use('/api/account', requireAuth, requireLiveSession(), (_req, res, next) => {
  res.set('Cache-Control', 'no-store')
  next()
})

accountRouter.get('/api/account/preferences', async (req, res) => {
  if (Object.keys(req.query).length) return res.status(400).json({ error: 'unknown_filter' })
  try {
    const [row] = await query('SELECT preferences, updated_at FROM dashboard_account_preferences WHERE user_id=$1', [req.user.id])
    res.json({ preferences: { ...DEFAULT_PREFERENCES, ...row?.preferences }, updated_at: row?.updated_at ?? null })
  } catch { res.status(503).json({ error: 'preferences_unavailable' }) }
})

accountRouter.patch('/api/account/preferences', async (req, res) => {
  let patch
  try {
    if (Object.keys(req.query).length) throw Error('unknown_filter')
    patch = parsePreferencesPatch(req.body)
  } catch (error) { return res.status(400).json({ error: error.message }) }
  try {
    const row = await transaction(async execute => {
      // Serialize same-account patches and recheck revocation before committing.
      const [user] = await execute('SELECT is_active, session_version FROM dashboard_users WHERE id=$1 FOR UPDATE', [req.user.id])
      if (!user?.is_active || user.session_version !== req.user.session_version) throw accountError(401, 'session_expired')
      const [saved] = await execute(`INSERT INTO dashboard_account_preferences(user_id,preferences)
        VALUES ($1,$2::jsonb) ON CONFLICT (user_id) DO UPDATE
        SET preferences=dashboard_account_preferences.preferences || EXCLUDED.preferences, updated_at=CURRENT_TIMESTAMP
        RETURNING preferences,updated_at`, [req.user.id, JSON.stringify(patch)])
      await execute(`INSERT INTO dashboard_account_audit(actor_id,target_id,action,changes)
        VALUES ($1,$1,'preferences.updated',$2::jsonb)`, [req.user.id, JSON.stringify({ preference_fields: Object.keys(patch).sort() })])
      return saved
    })
    res.json({ preferences: { ...DEFAULT_PREFERENCES, ...row.preferences }, updated_at: row.updated_at })
  } catch (error) {
    res.status(error.status === 401 ? 401 : 503).json({ error: error.status === 401 ? 'session_expired' : 'preferences_unavailable' })
  }
})

accountRouter.get('/api/account/activity', async (req, res) => {
  let filters
  try {
    if (Object.keys(req.query).some(key => !['limit', 'cursor', 'action'].includes(key))) throw Error('unknown_filter')
    filters = parseAuditQuery(req.query)
  } catch (error) { return res.status(400).json({ error: error.message }) }
  try {
    // Personal history is target-scoped, not the system-wide Admin audit feed.
    const page = await listAccountAudit(query, { ...filters, target_id: req.user.id })
    res.json({ ...page, items: page.items.map(({ id, action, created_at, changes }) => ({ id, action, created_at, changes })) })
  } catch { res.status(503).json({ error: 'activity_unavailable' }) }
})
