import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'

Object.assign(process.env, { PORT: '32000', CORS_ORIGIN_DASHBOARD: 'http://localhost:5180',
  JWT_SECRET: 'admin-test-only-secret', JWT_EXPIRES: '1h', DASHBOARD_ADMIN_EMAIL: 'admin@example.test',
  DASHBOARD_ADMIN_PASSWORD: 'test-only-password', PIPELINE_TRACKING_API_URL: 'http://unused',
  POSTGRES_HOST: 'unused', POSTGRES_PORT: '5432', POSTGRES_DB: 'test', POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test',
  QDRANT_URL: 'http://unused', QDRANT_COLLECTION: 'test', OLLAMA_URL: 'http://unused',
  OLLAMA_MODEL: 'test', OLLAMA_TIMEOUT_MS: '1000' })
const { createAdminV2Router } = await import('../src/routes/admin-v2.js')
const { createUsersRouter } = await import('../src/routes/users.js')
const { requireAuth } = await import('../src/middleware/auth.js')
const { requireLivePermission } = await import('../src/middleware/live-permission.js')
const { requireLiveSession } = await import('../src/middleware/live-session.js')
const { permissionsFor } = await import('../src/lib/roles.js')
const { mutateAccount } = await import('../src/lib/account-mutation.js')
const { assertAccountSchema, AccountSchemaError } = await import('../src/lib/account-schema.js')

test('admin capability routes reject stale grants, inactive users, outages and invalid scope', async () => {
  let role = 'super_admin', active = true, outage = false
  const calls = []
  const execute = async (sql, params) => {
    if (outage) throw new Error('private DB detail')
    if (sql.startsWith('SELECT role')) return [{ role, is_active: active }]
    calls.push({ sql, params })
    return [{ accepted: 3, terminal: 2, canonical: 2, kpi_applications: 2, pending_claims: 1 }]
  }
  const app = express()
  app.use(express.json(), createAdminV2Router(execute))
  app.use(requireAuth, requireLivePermission('user.manage', execute), createUsersRouter(execute))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const token = jwt.sign({ sub: 'self', role: 'super_admin' }, process.env.JWT_SECRET)
  const request = (path, init = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  try {
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/v2/admin/roles`)).status, 401)
    assert.equal((await request('/api/v2/admin/pipeline')).status, 400)
    const response = await request('/api/v2/admin/pipeline?source_id=shop')
    assert.equal(response.status, 200)
    assert.equal((await response.json()).runtime_status, 'UNVERIFIED')
    assert.deepEqual(calls[0].params, ['shop'])
    assert.equal(calls[0].sql.includes('tracking_events_clean'), false)
    assert.equal(permissionsFor('super_admin').includes('analytics.read'), false)
    const rolesResponse = await request('/api/v2/admin/roles')
    assert.equal(rolesResponse.status, 200)
    assert.deepEqual((await rolesResponse.json()).roles.map(item => item.role), ['super_admin', 'analyst', 'staff'])
    const count = calls.length
    assert.equal((await request('/api/v2/admin/audit?limit=101')).status, 400)
    assert.equal((await request('/api/users/self', { method: 'PATCH', body: JSON.stringify({ role: 'analyst' }) })).status, 400)
    assert.equal((await request('/api/users', { method: 'POST', body: JSON.stringify({ email: 'x@y.test', password: 'short' }) })).status, 400)
    assert.equal(calls.length, count)
    role = 'staff'
    assert.equal((await request('/api/v2/admin/audit')).status, 403)
    assert.equal((await request('/api/v2/admin/roles')).status, 403)
    assert.equal((await request('/api/users')).status, 403)
    role = 'analyst'
    assert.equal((await request('/api/v2/admin/audit')).status, 403)
    assert.equal((await request('/api/v2/admin/roles')).status, 403)
    assert.equal((await request('/api/users')).status, 403)
    active = false
    assert.equal((await request('/api/v2/admin/roles')).status, 401)
    outage = true
    assert.equal((await request('/api/v2/admin/audit')).status, 503)
    const failure = await request('/api/v2/admin/roles')
    assert.equal(failure.status, 503)
    assert.equal((await failure.text()).includes('private DB'), false)
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})

test('admin users and pipeline evidence work with PostgreSQL V2', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const schema = `admin_${randomUUID().replaceAll('-', '')}`
  const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` })
  let server
  try {
    await db.query(`CREATE SCHEMA ${schema}`)
    const dir = new URL('../../../infra/postgres/v2/', import.meta.url)
    for (const file of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
      await pool.query(await readFile(new URL(file, dir), 'utf8'))
    }
    await pool.query(`CREATE TABLE dashboard_users (id UUID PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT,
      display_name TEXT, role TEXT, is_active BOOLEAN DEFAULT TRUE, last_login_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())`)
    for (const file of ['006_dashboard_staff.sql', '007_dashboard_sessions.sql', '008_dashboard_account_audit.sql', '009_dashboard_audit_pagination.sql']) {
      await pool.query(await readFile(new URL(`../../../infra/postgres/${file}`, import.meta.url), 'utf8'))
    }
    const adminId = randomUUID()
    await pool.query("INSERT INTO dashboard_users(id,email,role) VALUES ($1,'admin@test.local','super_admin')", [adminId])
    const execute = async (sql, params) => (await pool.query(sql, params)).rows
    await assertAccountSchema(execute)
    await execute('ALTER TABLE dashboard_users DISABLE TRIGGER dashboard_revoke_sessions')
    await assert.rejects(assertAccountSchema(execute), AccountSchemaError)
    await execute('ALTER TABLE dashboard_users ENABLE TRIGGER dashboard_revoke_sessions')
    await assertAccountSchema(execute)
    const run = async work => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await work(async (sql, params) => (await client.query(sql, params)).rows)
        await client.query('COMMIT')
        return result
      } catch (error) { await client.query('ROLLBACK'); throw error }
      finally { client.release() }
    }
    const app = express()
    app.use(express.json(), requireAuth, requireLiveSession(execute), createAdminV2Router(execute))
    app.use(requireAuth, requireLivePermission('user.manage', execute), createUsersRouter(execute, run))
    server = app.listen(0, '127.0.0.1')
    await new Promise(resolve => server.once('listening', resolve))
    const bearer = jwt.sign({ sub: adminId, role: 'super_admin', session_version: 0 }, process.env.JWT_SECRET)
    const request = (path, method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const created = await request('/api/users', 'POST', { email: 'analyst@test.local', password: 'local-test-password', role: 'analyst' })
    assert.equal(created.status, 201)
    const { user } = await created.json()
    assert.equal(user.password_hash, undefined)
    assert.equal((await request(`/api/users/${user.id}`, 'PATCH', { is_active: false })).status, 200)
    assert.equal((await execute('SELECT is_active FROM dashboard_users WHERE id=$1', [user.id]))[0].is_active, false)
    assert.equal((await request(`/api/users/${user.id}`, 'PATCH', { is_active: true, role: 'super_admin' })).status, 200)
    assert.equal((await execute('SELECT session_version FROM dashboard_users WHERE id=$1', [user.id]))[0].session_version, 2)
    const audit = await execute('SELECT * FROM dashboard_account_audit ORDER BY created_at')
    assert.equal(audit.length, 3)
    assert.equal(JSON.stringify(audit).includes('local-test-password'), false)
    // Same microsecond timestamps exercise UUID tie-breaking and lossless cursors.
    await execute("UPDATE dashboard_account_audit SET created_at='2026-09-09T00:00:00.123456Z', changes=changes || '{\"password_hash\":\"must-not-leak\"}'::jsonb")
    let cursor = null
    const seen = []
    do {
      const pageResponse = await request(`/api/v2/admin/audit?limit=1${cursor ? `&cursor=${cursor}` : ''}`)
      assert.equal(pageResponse.status, 200)
      assert.equal(pageResponse.headers.get('cache-control'), 'no-store')
      const page = await pageResponse.json()
      assert.equal(JSON.stringify(page).includes('must-not-leak'), false)
      seen.push(...page.items.map(item => item.id))
      cursor = page.next_cursor
      assert.ok(seen.length <= 3)
    } while (cursor)
    assert.equal(new Set(seen).size, 3)
    const filtered = await request(`/api/v2/admin/audit?actor_id=${adminId}&target_id=${user.id}&action=account.created`)
    assert.equal((await filtered.json()).items.length, 1)
    const health = await request('/api/v2/admin/pipeline?source_id=empty-test-source')
    assert.equal(health.status, 200)
    const report = await health.json()
    assert.equal(report.metrics.canonical, 0)
    assert.equal(report.metrics.last_kpi_at, null)
    assert.equal(report.runtime_status, 'UNVERIFIED')
    await assert.rejects(mutateAccount({ id: adminId, session_version: 0 }, adminId, 'test', async sql => {
      await sql("UPDATE dashboard_users SET is_active=false WHERE role='super_admin'")
      return { user: {}, changes: {} }
    }, run), /last_active_admin_required/)
    assert.equal((await execute("SELECT COUNT(*)::int AS n FROM dashboard_users WHERE role='super_admin' AND is_active"))[0].n, 2)

    // Audit failure must roll back both the account change and session increment.
    await pool.query('ALTER TABLE dashboard_account_audit RENAME TO audit_temporarily_unavailable')
    assert.equal((await request(`/api/users/${user.id}`, 'PATCH', { is_active: false })).status, 500)
    assert.equal((await execute('SELECT is_active FROM dashboard_users WHERE id=$1', [user.id]))[0].is_active, true)
    await pool.query('ALTER TABLE audit_temporarily_unavailable RENAME TO dashboard_account_audit')

    const staleToken = jwt.sign({ sub: user.id, role: 'super_admin', session_version: 2 }, process.env.JWT_SECRET)
    assert.equal((await request(`/api/users/${user.id}`, 'PATCH', { password: 'new-local-test-password' })).status, 200)
    const revoked = await fetch(`http://127.0.0.1:${server.address().port}/api/v2/admin/roles`, {
      headers: { Authorization: `Bearer ${staleToken}` },
    })
    assert.equal(revoked.status, 401)
    const secondToken = jwt.sign({ sub: user.id, role: 'super_admin', session_version: 3 }, process.env.JWT_SECRET)
    const competing = await Promise.all([
      request(`/api/users/${user.id}`, 'DELETE'),
      fetch(`http://127.0.0.1:${server.address().port}/api/users/${adminId}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${secondToken}` },
      }),
    ])
    assert.equal(competing.filter(response => response.status === 200).length, 1)
    assert.equal((await execute("SELECT COUNT(*)::int AS n FROM dashboard_users WHERE role='super_admin' AND is_active"))[0].n, 1)
    await execute("UPDATE dashboard_users SET role='analyst' WHERE id=$1", [adminId])
    assert.ok([401, 403].includes((await request('/api/users')).status))
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
    await pool.end(); await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await db.end()
  }
})
