// Run through stdin INSIDE the isolated handoff API container, never the live demo.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
const require = createRequire('/workspace/apps/dashboard-api/package.json')
const { Client } = require('pg')
const env = process.env
assert.equal(env.POSTGRES_HOST, 'postgres')
assert.equal(env.POSTGRES_DB, 'funnelmetry_handoff')
assert.ok(env.DASHBOARD_ADMIN_EMAIL.endsWith('@handoff-acceptance.invalid'))
assert.ok(['initial', 'resume'].includes(env.HANDOFF_ACCEPTANCE_MODE))
const db = new Client({ host: env.POSTGRES_HOST, port: 5432, database: env.POSTGRES_DB,
  user: env.POSTGRES_USER, password: env.POSTGRES_PASSWORD, connectionTimeoutMillis: 10000 })
const base = 'http://dashboard-web:8080'
async function request(path, { method = 'GET', body, token } = {}) {
  return fetch(base + path, { method, signal: AbortSignal.timeout(15000),
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) })
}
async function login(email, password) {
  const result = await request('/api/auth/login', { method: 'POST', body: { email, password } })
  assert.equal(result.status, 200, 'password login through UI proxy')
  const { token } = await result.json()
  assert.equal(typeof token, 'string')
  return token
}
try {
  await db.connect()
  assert.equal((await db.query('SELECT status FROM handoff_bootstrap WHERE id=1')).rows[0].status, 'READY')
  assert.equal((await db.query('SELECT count(*)::int AS n FROM canonical_events')).rows[0].n, Number(env.HANDOFF_EXPECT_EVENTS || 0))
  for (const name of ['dashboard_users', 'dashboard_account_audit', 'analytical_execution_evidence', 'product_reference_names']) {
    assert.equal((await db.query('SELECT to_regclass($1)::text AS name', [`public.${name}`])).rows[0].name, name)
  }
  for (const flag of ['QWEN', 'POLARS', 'LEGACY', 'AI']) {
    assert.equal(env[`DASHBOARD_ENABLE_${flag}`], 'false')
  }
  const htmlResponse = await request('/chat')
  assert.equal(htmlResponse.status, 200, 'SPA deep-link fallback')
  const html = await htmlResponse.text()
  assert.match(html, /<div id="root"/)
  const scriptPath = html.match(/src="([^"]+\.js)"/)?.[1]
  assert.ok(scriptPath?.startsWith('/assets/'))
  assert.equal((await request(scriptPath)).status, 200, 'compiled JS served')
  assert.equal((await request('/api/users')).status, 401)
  const admin = await login(env.DASHBOARD_ADMIN_EMAIL, env.DASHBOARD_ADMIN_PASSWORD)
  const analystEmail = 'analyst@handoff-acceptance.invalid'
  const analystPassword = 'isolated-handoff-test-password-only'
  if (env.HANDOFF_ACCEPTANCE_MODE === 'initial') {
    const created = await request('/api/users', { method: 'POST', token: admin,
      body: { email: analystEmail, password: analystPassword, role: 'analyst' } })
    assert.equal(created.status, 201, 'Admin creates Analyst through the real API')
  }
  const users = await request('/api/users', { token: admin })
  assert.equal(users.status, 200)
  const { users: accounts } = await users.json()
  assert.equal(accounts.length, 2, 'no duplicate seed accounts after restart')
  const analyst = await login(analystEmail, analystPassword)
  assert.equal((await request('/api/users', { token: analyst })).status, 403)
  const events = '/api/v2/analytics/events?source_id=medusa-reference&limit=5'
  assert.equal((await request(events, { token: admin })).status, 403)
  assert.equal((await request(events, { token: analyst })).status, 200)
  if (env.HANDOFF_CHECK_SUMMARY === 'true') {
    const summary = await request('/api/v2/chat/order-summary', { method: 'POST', token: analyst,
      body: { source_id: 'medusa-reference', from: '2026-09-22', to: '2026-09-23' } })
    assert.equal(summary.status, 200)
    const evidence = (await summary.json()).evidence[0]
    assert.equal(evidence.status, 'PROVISIONAL')
    assert.equal(evidence.result.groups[0].values['measure.gross_order_value@1.0.0'], '20')
    console.log('PASS: governed staging summary HTTP/evidence, EUR 20; no provider call')
  }
  assert.equal((await request('/api/v2/admin/mappings', { token: admin })).status, 200, 'mapping artifact packaged')
  assert.equal((await request('/api/auth/logout-all', { method: 'POST', body: {}, token: analyst })).status, 200)
  assert.equal((await request(events, { token: analyst })).status, 401, 'session revocation enforced')
  console.log(`PASS: handoff ${env.HANDOFF_ACCEPTANCE_MODE}: schema, empty data, SPA/assets, proxy login, RBAC, mapping, account persistence, logout`)
} catch {
  // Never dump fetch/assert objects which could contain credentials or tokens.
  console.error(`FAIL: handoff ${env.HANDOFF_ACCEPTANCE_MODE} acceptance; inspect isolated services, not the live demo`)
  process.exitCode = 1
} finally { await db.end() }
