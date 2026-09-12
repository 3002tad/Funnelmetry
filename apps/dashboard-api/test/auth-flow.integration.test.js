import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'

test('real app login, password change, audit rollback and lock/unlock revoke sessions',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const url = new URL(process.env.TEST_DATABASE_URL)
    const schema = `auth_${randomUUID().replaceAll('-', '')}`
    Object.assign(process.env, {
      PORT: '32000', CORS_ORIGIN_DASHBOARD: 'http://localhost:5180',
      JWT_SECRET: 'auth-flow-test-only', JWT_EXPIRES: '1h', DASHBOARD_ADMIN_EMAIL: 'admin@test.invalid',
      DASHBOARD_ADMIN_PASSWORD: 'initial-test-password',
      POSTGRES_HOST: url.hostname, POSTGRES_PORT: url.port || '5432', POSTGRES_DB: url.pathname.slice(1),
      POSTGRES_USER: decodeURIComponent(url.username), POSTGRES_PASSWORD: decodeURIComponent(url.password),
      PGOPTIONS: `-c search_path=${schema}`,
    })
    const legacy = process.env.DASHBOARD_ENABLE_LEGACY === 'true'
    const ai = process.env.DASHBOARD_ENABLE_AI === 'true'
    if (legacy) process.env.PIPELINE_TRACKING_API_URL = 'http://unused'
    else delete process.env.PIPELINE_TRACKING_API_URL
    for (const [key, value] of Object.entries({ QDRANT_URL: 'http://unused', QDRANT_COLLECTION: 'test',
      OLLAMA_URL: 'http://unused', OLLAMA_MODEL: 'test', OLLAMA_TIMEOUT_MS: '1000' })) {
      if (ai) process.env[key] = value
      else delete process.env[key]
    }
    const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` })
    let server, closeDatabase
    try {
      await db.query(`CREATE SCHEMA ${schema}`)
      for (const file of ['003_dashboard_users.sql', '006_dashboard_staff.sql', '007_dashboard_sessions.sql',
        '008_dashboard_account_audit.sql', '009_dashboard_audit_pagination.sql', '010_dashboard_preferences.sql']) {
        await db.query(await readFile(new URL(`../../../infra/postgres/${file}`, import.meta.url), 'utf8'))
      }
      const { createApp } = await import('../src/app.js')
      const { checkAccountSchema } = await import('../src/lib/check-account-schema.js')
      assert.equal((await checkAccountSchema()).status, 'READY')
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM dashboard_users')).rows[0].n, 0)
      await db.query('ALTER TABLE dashboard_users DISABLE TRIGGER dashboard_revoke_sessions')
      assert.equal((await checkAccountSchema()).status, 'MIGRATION_REQUIRED')
      await db.query('ALTER TABLE dashboard_users ENABLE TRIGGER dashboard_revoke_sessions')
      const { seedAdminUser } = await import('../src/seed.js')
      ;({ closeDatabase } = await import('../src/db.js'))
      // Audit is part of bootstrap, so its failure cannot leave an unaudited Admin.
      await db.query('ALTER TABLE dashboard_account_audit RENAME TO audit_missing')
      await assert.rejects(seedAdminUser())
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM dashboard_users')).rows[0].n, 0)
      await db.query('ALTER TABLE audit_missing RENAME TO dashboard_account_audit')
      await Promise.all([seedAdminUser(), seedAdminUser(), seedAdminUser()])
      assert.equal((await db.query('SELECT COUNT(*)::int AS n FROM dashboard_users')).rows[0].n, 1)
      const bootstrap = await db.query("SELECT * FROM dashboard_account_audit WHERE action='account.bootstrapped'")
      assert.equal(bootstrap.rows.length, 1)
      assert.equal(bootstrap.rows[0].actor_id, bootstrap.rows[0].target_id)
      server = createApp().listen(0, '127.0.0.1')
      await new Promise(resolve => server.once('listening', resolve))
      const request = (path, method = 'GET', body, token) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      const login = (email, password) => request('/api/auth/login', 'POST', { email, password })
      assert.equal((await request('/api/auth/me')).status, 401)
      const adminLogin = await login('admin@test.invalid', 'initial-test-password')
      assert.equal(adminLogin.status, 200)
      const admin = await adminLogin.json()
      assert.equal((await request('/api/v2/chat', 'POST', {}, admin.token)).status, 403)
      // Account-only schema must report unavailable V2 evidence, not an empty inventory.
      assert.equal((await request('/api/v2/admin/sources', 'GET', null, admin.token)).status, 503)
      assert.equal((await request('/api/chat', 'POST', {}, admin.token)).status, 403)
      assert.equal((await request('/api/chat/insights', 'GET', null, admin.token)).status, 403)
      for (const path of ['/api/chat/sessions', '/API/chat/sessions/', '/API/chat/insights/']) {
        assert.equal((await request(path, 'GET', null, admin.token)).status, 403)
        assert.equal((await request(path)).status, 401)
      }
      assert.equal((await request('/API/chat/', 'POST', {}, admin.token)).status, 403)
      if (!legacy) {
        const disabled = await request('/api/system/pipeline', 'GET', null, admin.token)
        assert.equal(disabled.status, 503)
        assert.deepEqual(await disabled.json(), { error: 'module_disabled', module: 'legacy' })
      }
      assert.equal((await request('/api/users', 'POST', {
        email: 'analyst@test.invalid', password: 'analyst-test-password', role: 'analyst',
      }, admin.token)).status, 201)
      const analyst = await (await login('analyst@test.invalid', 'analyst-test-password')).json()
      assert.equal((await request('/api/v2/chat', 'POST', {}, analyst.token)).status, 503)
      assert.equal((await request('/api/v2/admin/sources', 'GET', null, analyst.token)).status, 403)
      assert.equal((await request('/api/chat', 'POST', {}, analyst.token)).status, ai ? 400 : 503)
      if (!ai) assert.equal((await request('/api/chat/insights', 'GET', null, analyst.token)).status, 503)
      if (!legacy) assert.equal((await request('/api/events/stream', 'GET', null, analyst.token)).status, 503)
      if (legacy) {
        const { eventBus } = await import('../src/lib/event-bus.js')
        const abortStream = new AbortController()
        const deadline = setTimeout(() => abortStream.abort(), 5000)
        try {
          const stream = await fetch(`http://127.0.0.1:${server.address().port}/api/events/stream`, {
            headers: { Authorization: `Bearer ${analyst.token}` }, signal: abortStream.signal,
          })
          assert.equal(stream.status, 200)
          const reader = stream.body.getReader()
          eventBus.emit('events', [{ event_id: 'before-revoke' }])
          const first = await reader.read()
          assert.equal(new TextDecoder().decode(first.value).includes('before-revoke'), true)
          assert.equal((await request('/api/auth/logout-all', 'POST', null, analyst.token)).status, 200)
          eventBus.emit('events', [{ event_id: 'after-revoke' }])
          assert.equal((await reader.read()).done, true)
          assert.equal(eventBus.listenerCount('events'), 0)
        } finally { clearTimeout(deadline); abortStream.abort() }
      }
      const created = await request('/api/users', 'POST', {
        email: 'staff@test.invalid', password: 'initial-staff-password', role: 'staff',
      }, admin.token)
      assert.equal(created.status, 201)
      const { user } = await created.json()
      const staffLogin = await login('staff@test.invalid', 'initial-staff-password')
      assert.equal(staffLogin.status, 200)
      const staff = await staffLogin.json()
      assert.equal((await request('/api/v2/admin/sources', 'GET', null, staff.token)).status, 403)
      const preferencesPath = '/api/account/preferences'
      assert.equal((await request(preferencesPath)).status, 401)
      const defaultsResponse = await request(preferencesPath, 'GET', null, staff.token)
      assert.equal(defaultsResponse.headers.get('cache-control'), 'no-store')
      const defaults = await defaultsResponse.json()
      assert.equal(defaults.preferences.theme, 'system')
      assert.equal(defaults.updated_at, null)
      assert.equal((await request(preferencesPath, 'PATCH', { role: 'super_admin' }, staff.token)).status, 400)
      assert.equal((await request(`${preferencesPath}?user_id=${admin.user.id}`, 'GET', null, staff.token)).status, 400)
      const patches = await Promise.all([
        request(preferencesPath, 'PATCH', { theme: 'light' }, staff.token),
        request(preferencesPath, 'PATCH', { language: 'en' }, staff.token),
      ])
      assert.deepEqual(patches.map(result => result.status), [200, 200])
      const saved = await (await request(preferencesPath, 'GET', null, staff.token)).json()
      assert.equal(saved.preferences.theme, 'light')
      assert.equal(saved.preferences.language, 'en')
      assert.ok(saved.updated_at)
      assert.equal((await (await request(preferencesPath, 'GET', null, admin.token)).json()).preferences.theme, 'system')
      const secondStaff = await (await login('staff@test.invalid', 'initial-staff-password')).json()
      assert.deepEqual((await (await request(preferencesPath, 'GET', null, secondStaff.token)).json()).preferences, saved.preferences)
      await db.query('ALTER TABLE dashboard_account_audit RENAME TO audit_missing')
      assert.equal((await request(preferencesPath, 'PATCH', { theme: 'dark' }, staff.token)).status, 503)
      assert.equal((await request('/api/account/activity', 'GET', null, staff.token)).status, 503)
      await db.query('ALTER TABLE audit_missing RENAME TO dashboard_account_audit')
      assert.equal((await (await request(preferencesPath, 'GET', null, staff.token)).json()).preferences.theme, 'light')
      const activity = await (await request('/api/account/activity?limit=1&action=preferences.updated', 'GET', null, staff.token)).json()
      assert.equal(activity.items.length, 1)
      assert.ok(activity.next_cursor)
      assert.deepEqual(activity.items[0].changes, { preferences_updated: true })
      assert.deepEqual(Object.keys(activity.items[0]).sort(), ['action', 'changes', 'created_at', 'id'])
      const nextActivity = await (await request(`/api/account/activity?limit=1&action=preferences.updated&cursor=${activity.next_cursor}`, 'GET', null, staff.token)).json()
      assert.equal(nextActivity.items.length, 1)
      assert.notEqual(nextActivity.items[0].id, activity.items[0].id)
      assert.equal(nextActivity.next_cursor, null)
      assert.equal((await (await request('/api/account/activity?action=preferences.updated', 'GET', null, admin.token)).json()).items.length, 0)
      assert.equal((await request(`/api/account/activity?target_id=${admin.user.id}`, 'GET', null, staff.token)).status, 400)
      await db.query('ALTER TABLE dashboard_account_preferences RENAME TO preferences_missing')
      assert.equal((await request(preferencesPath, 'GET', null, staff.token)).status, 503)
      await db.query('ALTER TABLE preferences_missing RENAME TO dashboard_account_preferences')
      assert.equal((await request('/api/chat', 'POST', {}, staff.token)).status, ai ? 400 : 503)
      if (!ai) assert.equal((await request('/api/chat/insights', 'GET', null, staff.token)).status, 503)
      assert.equal((await request('/api/auth/me', 'GET', null, staff.token)).status, 200)
      assert.equal((await request('/api/v2/admin/audit', 'GET', null, staff.token)).status, 403)
      assert.equal((await request('/api/v2/analytics/journeys', 'GET', null, staff.token)).status, 403)
      assert.equal((await request('/api/auth/change-password', 'PATCH', {
        current_password: 'initial-staff-password', new_password: 'short',
      }, staff.token)).status, 400)
      assert.equal((await request('/api/auth/change-password', 'PATCH', {
        current_password: 'initial-staff-password', new_password: 'changed-staff-password',
      }, staff.token)).status, 200)
      assert.equal((await request('/api/auth/me', 'GET', null, staff.token)).status, 401)
      assert.equal((await request(preferencesPath, 'PATCH', { theme: 'dark' }, staff.token)).status, 401)
      assert.equal((await request('/api/account/activity', 'GET', null, staff.token)).status, 401)
      assert.equal((await login('staff@test.invalid', 'initial-staff-password')).status, 401)
      const currentLogin = await login('staff@test.invalid', 'changed-staff-password')
      assert.equal(currentLogin.status, 200)
      const current = await currentLogin.json()

      await db.query('ALTER TABLE dashboard_account_audit RENAME TO audit_missing')
      assert.equal((await request('/api/auth/change-password', 'PATCH', {
        current_password: 'changed-staff-password', new_password: 'must-rollback-password',
      }, current.token)).status, 500)
      assert.equal((await request('/api/auth/me', 'GET', null, current.token)).status, 200)
      assert.equal((await login('staff@test.invalid', 'changed-staff-password')).status, 200)
      await db.query('ALTER TABLE audit_missing RENAME TO dashboard_account_audit')
      for (const active of [false, true]) {
        assert.equal((await request(`/api/users/${user.id}`, 'PATCH', { is_active: active }, admin.token)).status, 200)
        assert.equal((await request('/api/auth/me', 'GET', null, current.token)).status, 401)
        if (!active) assert.equal((await login('staff@test.invalid', 'changed-staff-password')).status, 401)
      }
      assert.equal((await login('staff@test.invalid', 'changed-staff-password')).status, 200)
      const audit = await db.query("SELECT * FROM dashboard_account_audit WHERE action='password.changed'")
      assert.equal(audit.rows.length, 1)
      assert.equal(audit.rows[0].actor_id, user.id)
      assert.deepEqual(audit.rows[0].changes, { password_changed: true })

      assert.equal((await request('/api/auth/logout-all', 'POST')).status, 401)
      const sessionA = await (await login('staff@test.invalid', 'changed-staff-password')).json()
      const sessionB = await (await login('staff@test.invalid', 'changed-staff-password')).json()
      await db.query('ALTER TABLE dashboard_account_audit RENAME TO audit_missing')
      assert.equal((await request('/api/auth/logout-all', 'POST', null, sessionA.token)).status, 503)
      assert.equal((await request('/api/auth/me', 'GET', null, sessionA.token)).status, 200)
      await db.query('ALTER TABLE audit_missing RENAME TO dashboard_account_audit')
      const attempts = await Promise.all([
        request('/api/auth/logout-all', 'POST', null, sessionA.token),
        request('/api/auth/logout-all', 'POST', null, sessionB.token),
      ])
      assert.deepEqual(attempts.map(result => result.status).sort(), [200, 401])
      for (const token of [sessionA.token, sessionB.token]) {
        assert.equal((await request('/api/auth/me', 'GET', null, token)).status, 401)
      }
      const revocations = await db.query("SELECT * FROM dashboard_account_audit WHERE action='sessions.revoked' AND target_id=$1", [user.id])
      assert.equal(revocations.rows.length, 1)
      assert.deepEqual(revocations.rows[0].changes, { sessions_revoked: true })
      assert.equal((await login('staff@test.invalid', 'changed-staff-password')).status, 200)
      assert.equal((await request('/api/auth/me', 'GET', null, admin.token)).status, 200)

      // Restart/bootstrap must not restore a locked account or reset its password.
      await db.query("UPDATE dashboard_users SET is_active=false WHERE email='admin@test.invalid'")
      const before = await db.query("SELECT password_hash,session_version,is_active FROM dashboard_users WHERE email='admin@test.invalid'")
      await seedAdminUser()
      const after = await db.query("SELECT password_hash,session_version,is_active FROM dashboard_users WHERE email='admin@test.invalid'")
      assert.deepEqual(after.rows, before.rows)
      assert.equal((await db.query("SELECT COUNT(*)::int AS n FROM dashboard_account_audit WHERE action='account.bootstrapped'")).rows[0].n, 1)
    } finally {
      if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
      if (closeDatabase) await closeDatabase()
      await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
      await db.end()
    }
  })
