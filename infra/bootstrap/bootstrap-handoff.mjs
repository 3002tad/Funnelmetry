// Explicit clean-database bootstrap for the isolated OFFLINE_DEMO package.
// Not an upgrader or restore tool. Never seed business events or reset accounts.
import { readFile, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

export function validateTarget(env) {
  if (env.HANDOFF_MODE !== 'OFFLINE_DEMO' || env.POSTGRES_HOST !== 'postgres'
      || env.POSTGRES_DB !== 'funnelmetry_handoff') throw Error('HANDOFF_TARGET_REJECTED')
}
export async function bootstrap(client, files, sql, log = console.log) {
  const digest = createHash('sha256').update(JSON.stringify(files.map((f, i) => [f, sql[i]]))).digest('hex')
  await client.query("SELECT pg_advisory_lock(hashtext('funnelmetry-offline-handoff-bootstrap'))")
  const { rows } = await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public'")
  if (rows.length) {
    if (!rows.some(r => r.tablename === 'handoff_bootstrap')) throw Error('HANDOFF_DATABASE_NOT_EMPTY')
    const { rows: [state] } = await client.query('SELECT status, schema_digest FROM handoff_bootstrap WHERE id=1')
    if (state?.status !== 'READY' || state.schema_digest !== digest) throw Error('HANDOFF_REQUIRES_OPERATOR_REVIEW')
    log('PASS: existing offline schema matches; no reseed or migration performed')
  } else {
    await client.query('CREATE TABLE handoff_bootstrap (id integer PRIMARY KEY CHECK(id=1), status text NOT NULL, schema_digest text NOT NULL)')
    await client.query("INSERT INTO handoff_bootstrap VALUES (1,'INSTALLING',$1)", [digest])
    for (let i = 0; i < sql.length; i++) {
      await client.query(sql[i])
      log(`Applied ${files[i].replace('/workspace/', '')}`)
    }
    await client.query("UPDATE handoff_bootstrap SET status='READY' WHERE id=1")
    log('PASS: clean offline schema installed; dataset empty; AI/ingestion disabled')
  }
}

async function main() {
  validateTarget(process.env)
  const require = createRequire('/workspace/apps/dashboard-api/package.json')
  const { Client } = require('pg')
  const client = new Client({ host: 'postgres', port: 5432, database: 'funnelmetry_handoff',
    user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD,
    connectionTimeoutMillis: 10000 })
  const root = '/workspace/infra/postgres'
  const core = (await readdir(`${root}/v2`)).filter(f => /^\d+.*\.sql$/.test(f)).sort()
  const files = [...core.map(f => `${root}/v2/${f}`),
  ...['003_dashboard_users.sql', '006_dashboard_staff.sql', '007_dashboard_sessions.sql',
    '008_dashboard_account_audit.sql', '009_dashboard_audit_pagination.sql',
    '010_dashboard_preferences.sql'].map(f => `${root}/${f}`),
  ...['fact-order-v1.sql', 'catalog-v1.sql', 'evidence-v1.sql', 'evidence-notes-v1.sql',
    'evidence-notes-v2.sql', 'product-value-v1.sql'].map(f => `/workspace/analytics/sql/${f}`)]
  const sql = await Promise.all(files.map(f => readFile(f, 'utf8')))
  try {
    await client.connect()
    await bootstrap(client, files, sql)
  } finally { await client.end() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await main() } catch {
    // SQL errors can include data/config. Keep operator-facing failure sanitized.
    console.error('Handoff bootstrap failed. Do not start API; inspect isolated DB/migration compatibility. No automatic reset.')
    process.exitCode = 1
  }
}
