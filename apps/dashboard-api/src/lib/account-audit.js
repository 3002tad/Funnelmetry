const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const actions = ['account.created', 'account.updated', 'account.disabled', 'password.changed', 'account.bootstrapped', 'sessions.revoked']

export function parseAuditQuery(query) {
  const allowed = ['limit', 'cursor', 'actor_id', 'target_id', 'action']
  if (Object.keys(query).some(key => !allowed.includes(key))) throw Error('unknown_filter')
  const limit = query.limit === undefined ? 25 : Number(query.limit)
  if ((query.limit !== undefined && (typeof query.limit !== 'string' || !/^\d+$/.test(query.limit)))
    || !Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('invalid_limit')
  const result = { limit }
  for (const field of ['actor_id', 'target_id']) {
    if (query[field] !== undefined) {
      if (typeof query[field] !== 'string' || !uuid.test(query[field])) throw Error(`invalid_${field}`)
      result[field] = query[field]
    }
  }
  if (query.action !== undefined) {
    if (!actions.includes(query.action)) throw Error('invalid_action')
    result.action = query.action
  }
  if (query.cursor !== undefined) {
    try {
      if (typeof query.cursor !== 'string' || query.cursor.length > 400 || !/^[\w-]+$/.test(query.cursor)) throw Error()
      const cursor = JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'))
      if (!uuid.test(cursor.id) || typeof cursor.at !== 'string'
        || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{6}Z$/.test(cursor.at)
        || !Number.isFinite(Date.parse(cursor.at)) || Number(cursor.at.slice(0, 4)) < 1
        || new Date(cursor.at).toISOString() !== `${cursor.at.slice(0, 23)}Z`) throw Error()
      result.cursor = cursor
    } catch { throw Error('invalid_cursor') }
  }
  return result
}

export async function listAccountAudit(execute, filters) {
  const params = [], clauses = []
  for (const field of ['actor_id', 'target_id', 'action']) {
    if (filters[field] !== undefined) {
      params.push(filters[field]); clauses.push(`${field}=$${params.length}`)
    }
  }
  if (filters.cursor) {
    params.push(filters.cursor.at, filters.cursor.id)
    clauses.push(`(created_at,id)<($${params.length - 1}::timestamptz,$${params.length}::uuid)`)
  }
  params.push(filters.limit + 1)
  const rows = await execute(`SELECT id, actor_id, target_id, action,
    to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at,
    jsonb_strip_nulls(jsonb_build_object(
      'role', changes->'role', 'is_active', changes->'is_active',
      'password_changed', changes->'password_changed',
      'sessions_revoked', changes->'sessions_revoked',
      'display_name_changed', CASE WHEN changes ? 'display_name' THEN true ELSE NULL END
    )) AS changes
    FROM dashboard_account_audit ${clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''}
    ORDER BY created_at DESC, id DESC LIMIT $${params.length}`, params)
  const more = rows.length > filters.limit
  const items = rows.slice(0, filters.limit), last = items.at(-1)
  return { items, limit: filters.limit, next_cursor: more
    ? Buffer.from(JSON.stringify({ at: last.created_at, id: last.id })).toString('base64url') : null }
}
