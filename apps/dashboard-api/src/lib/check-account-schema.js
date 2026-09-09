import pg from 'pg'
import { assertAccountSchema, AccountSchemaError } from './account-schema.js'

const migrations = ['003_dashboard_users.sql', '006_dashboard_staff.sql', '007_dashboard_sessions.sql',
  '008_dashboard_account_audit.sql', '009_dashboard_audit_pagination.sql']

export async function checkAccountSchema(env = process.env, createClient = options => new pg.Client(options)) {
  const required = ['POSTGRES_HOST', 'POSTGRES_PORT', 'POSTGRES_DB', 'POSTGRES_USER', 'POSTGRES_PASSWORD']
  const missing = required.filter(name => typeof env[name] !== 'string' || !env[name].trim())
  if (missing.length) return { status: 'INVALID_CONFIG', missing }
  const port = Number(env.POSTGRES_PORT)
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { status: 'INVALID_CONFIG', missing: ['valid POSTGRES_PORT'] }
  const client = createClient({ host: env.POSTGRES_HOST, port, database: env.POSTGRES_DB,
    user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD,
    connectionTimeoutMillis: 5000, query_timeout: 5000 })
  try {
    await client.connect()
    await client.query('BEGIN READ ONLY')
    await client.query("SET LOCAL statement_timeout = '4s'")
    await assertAccountSchema(async (sql, params) => (await client.query(sql, params)).rows)
    await client.query('COMMIT')
    return { status: 'READY', scope: 'dashboard_account_schema', read_only: true }
  } catch (error) {
    try { await client.query('ROLLBACK') } catch { /* Connection may not be established. */ }
    return error instanceof AccountSchemaError
      ? { status: 'MIGRATION_REQUIRED', migrations, read_only: true }
      : { status: 'UNAVAILABLE', scope: 'dashboard_account_schema', read_only: true }
  } finally { await client.end().catch(() => {}) }
}
