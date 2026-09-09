import { transaction } from '../db.js'
import { hasPermission } from './roles.js'

export function accountError(status, message) {
  return Object.assign(new Error(message), { status })
}

// Serialize account-management writes before reading actor/last-admin state.
export async function mutateAccount(actor, targetId, action, work, run = transaction) {
  return run(async execute => {
    await execute('LOCK TABLE dashboard_users IN SHARE ROW EXCLUSIVE MODE')
    const [current] = await execute('SELECT role, is_active, session_version FROM dashboard_users WHERE id=$1', [actor.id])
    if (!current?.is_active || !Number.isInteger(actor.session_version)
      || current.session_version !== actor.session_version) throw accountError(401, 'session_expired')
    if (!hasPermission(current.role, 'user.manage')) throw accountError(403, 'forbidden')
    const result = await work(execute)
    const [{ count }] = await execute("SELECT COUNT(*)::int AS count FROM dashboard_users WHERE role='super_admin' AND is_active=true")
    if (count < 1) throw accountError(409, 'last_active_admin_required')
    await execute(`INSERT INTO dashboard_account_audit(actor_id,target_id,action,changes)
      VALUES ($1,$2,$3,$4::jsonb)`, [actor.id, targetId, action, JSON.stringify(result.changes)])
    return result.user
  })
}
