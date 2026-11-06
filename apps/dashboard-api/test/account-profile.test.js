import test from 'node:test'
import assert from 'node:assert/strict'
Object.assign(process.env, { PORT: '32000', CORS_ORIGIN_DASHBOARD: 'http://localhost:5180', JWT_SECRET: 'profile-test-only', JWT_EXPIRES: '1h', DASHBOARD_ADMIN_EMAIL: 'test@example.invalid', DASHBOARD_ADMIN_PASSWORD: 'test', POSTGRES_HOST: 'unused', POSTGRES_PORT: '5432', POSTGRES_DB: 'unused', POSTGRES_USER: 'unused', POSTGRES_PASSWORD: 'unused' })
const { parseDisplayName, updateOwnProfile } = await import('../src/lib/account-profile.js')

test('profile allows a bounded name and rejects identity/permission fields', () => {
  assert.equal(parseDisplayName({ display_name: '  Analyst  ' }), 'Analyst')
  for (const body of [null, {}, { display_name: ' ' }, { display_name: 'x'.repeat(101) }, { display_name: 'OK', id: 'other' }, { display_name: 'OK', role: 'super_admin' }]) assert.throws(() => parseDisplayName(body))
  assert.throws(() => parseDisplayName({ display_name: 'OK' }, { id: 'other' }))
})

test('profile locks current actor, rejects revoked sessions and audits in the same transaction', async () => {
  const actor = { id: 'self', session_version: 1 }
  let active = true, version = 1, committed = false, failAudit = false
  const calls = []
  const transaction = async work => {
    committed = false
    const result = await work(async (sql, args) => {
      calls.push({ sql, args })
      assert.equal(args[0], 'self')
      if (sql.startsWith('SELECT')) return [{ is_active: active, session_version: version }]
      if (sql.startsWith('INSERT') && failAudit) throw Error('audit unavailable')
      return [{ id: 'self', display_name: args[1] }]
    })
    committed = true
    return result
  }
  assert.equal((await updateOwnProfile(transaction, actor, 'New Name')).display_name, 'New Name')
  assert.equal(committed, true)
  assert.match(calls[0].sql, /FOR UPDATE/)
  assert.match(calls[2].sql, /dashboard_account_audit/)
  assert.ok(!calls[2].args[1].includes('New Name'))
  for (const revoked of [true, false]) {
    active = !revoked; version = revoked ? 1 : 2; calls.length = 0
    await assert.rejects(updateOwnProfile(transaction, actor, 'New Name'), { status: 401 })
    assert.equal(calls.length, 1)
    assert.equal(committed, false)
  }
  active = true; version = 1; failAudit = true
  await assert.rejects(updateOwnProfile(transaction, actor, 'New Name'), /audit unavailable/)
  assert.equal(committed, false)
})
