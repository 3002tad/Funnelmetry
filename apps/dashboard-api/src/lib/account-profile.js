import { accountError } from './account-mutation.js'

export function parseDisplayName(body, filters = {}) {
  const value = body?.display_name
  if (Object.keys(filters).length || !body || Object.keys(body).some(key => key !== 'display_name') || typeof value !== 'string' || !value.trim() || value.trim().length > 100) {
    throw accountError(400, 'invalid_display_name')
  }
  return value.trim()
}

export async function updateOwnProfile(transaction, actor, displayName) {
  return transaction(async execute => {
    const [current] = await execute('SELECT is_active,session_version FROM dashboard_users WHERE id=$1 FOR UPDATE', [actor.id])
    if (!current?.is_active || current.session_version !== actor.session_version) throw accountError(401, 'session_expired')
    const [saved] = await execute('UPDATE dashboard_users SET display_name=$2,updated_at=CURRENT_TIMESTAMP WHERE id=$1 RETURNING id,email,display_name,role', [actor.id, displayName])
    await execute("INSERT INTO dashboard_account_audit(actor_id,target_id,action,changes) VALUES ($1,$1,'account.updated',$2::jsonb)", [actor.id, JSON.stringify({ display_name_updated: true })])
    return saved
  })
}
