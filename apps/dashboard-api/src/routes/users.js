import { Router } from 'express'
import { randomUUID } from 'node:crypto'
import { query, transaction } from '../db.js'
import { hashPassword } from '../lib/password.js'
import { ASSIGNABLE_ROLES } from '../lib/roles.js'
import { accountError, mutateAccount } from '../lib/account-mutation.js'

const publicFields = 'id, email, display_name, role, is_active, last_login_at, created_at, updated_at'
function failure(res, error) {
  if (error.code === '23505') return res.status(409).json({ error: 'email_exists' })
  return res.status(error.status ?? 500).json({ error: error.status ? error.message : 'account_mutation_failed' })
}
export function createUsersRouter(execute = query, run = transaction) {
  const router = Router()
  router.get('/api/users', async (_req, res) => {
    try { res.json({ users: await execute(`SELECT ${publicFields} FROM dashboard_users ORDER BY created_at DESC`) }) }
    catch { res.status(500).json({ error: 'query_failed' }) }
  })
  router.post('/api/users', async (req, res) => {
    const { email, password, display_name, role = 'analyst' } = req.body ?? {}
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
      || typeof password !== 'string' || password.length < 12
      || (display_name != null && (typeof display_name !== 'string' || display_name.length > 100))) {
      return res.status(400).json({ error: 'invalid_account' })
    }
    if (!ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ error: 'invalid_role' })
    try {
      const id = randomUUID(), hash = await hashPassword(password)
      const user = await mutateAccount(req.user, id, 'account.created', async sql => {
        const [user] = await sql(`INSERT INTO dashboard_users(id,email,password_hash,display_name,role)
          VALUES ($1,$2,$3,$4,$5) RETURNING ${publicFields}`, [id, email.trim().toLowerCase(), hash, display_name ?? null, role])
        return { user, changes: { role, is_active: true } }
      }, run)
      res.status(201).json({ user })
    } catch (error) { failure(res, error) }
  })
  async function update(req, res, disable = false) {
    const { display_name, role, is_active, password } = disable ? { is_active: false } : req.body ?? {}
    if (req.params.id === req.user.id && (role !== undefined || is_active !== undefined)) {
      return res.status(400).json({ error: 'cannot_change_own_access' })
    }
    if ((role !== undefined && !ASSIGNABLE_ROLES.includes(role))
      || (is_active !== undefined && typeof is_active !== 'boolean')
      || (password !== undefined && (typeof password !== 'string' || password.length < 12))
      || (display_name !== undefined && (typeof display_name !== 'string' || display_name.length > 100))) {
      return res.status(400).json({ error: 'invalid_account_update' })
    }
    try {
      const hash = password === undefined ? null : await hashPassword(password)
      const user = await mutateAccount(req.user, req.params.id, disable ? 'account.disabled' : 'account.updated', async sql => {
        const [before] = await sql(`SELECT ${publicFields} FROM dashboard_users WHERE id=$1`, [req.params.id])
        if (!before) throw accountError(404, 'not_found')
        const [user] = await sql(`UPDATE dashboard_users SET display_name=COALESCE($1,display_name),
          role=COALESCE($2,role), is_active=COALESCE($3,is_active), password_hash=COALESCE($4,password_hash),
          updated_at=CURRENT_TIMESTAMP WHERE id=$5 RETURNING ${publicFields}`,
        [display_name ?? null, role ?? null, is_active ?? null, hash, req.params.id])
        const changes = { password_changed: hash !== null }
        for (const field of ['display_name', 'role', 'is_active']) {
          if (before[field] !== user[field]) changes[field] = { before: before[field], after: user[field] }
        }
        return { user, changes }
      }, run)
      res.json(disable ? { ok: true } : { user })
    } catch (error) { failure(res, error) }
  }
  router.patch('/api/users/:id', (req, res) => update(req, res))
  router.delete('/api/users/:id', (req, res) => update(req, res, true))
  return router
}
export const usersRouter = createUsersRouter()
