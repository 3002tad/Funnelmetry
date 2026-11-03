import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'

Object.assign(process.env, { PORT: '32000', CORS_ORIGIN_DASHBOARD: 'http://localhost:5180',
  JWT_SECRET: 'ai-identity-test-only-secret', JWT_EXPIRES: '1h', DASHBOARD_ADMIN_EMAIL: 'admin@example.test',
  DASHBOARD_ADMIN_PASSWORD: 'test-only-password', POSTGRES_HOST: 'unused', POSTGRES_PORT: '5432',
  POSTGRES_DB: 'test', POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test' })
const { createAiIdentityRouter } = await import('../src/routes/ai-identity.js')

test('AI identity checks the live account, session and role rather than trusting client headers or token role', async () => {
  let account = { role: 'analyst', is_active: true, session_version: 1 }
  let unavailable = false
  const app = express()
  app.use(createAiIdentityRouter({ execute: async () => {
    if (unavailable) throw new Error('database unavailable')
    return [account]
  } }))
  const server = app.listen(0)
  await new Promise(resolve => server.once('listening', resolve))
  const token = jwt.sign({ sub: 'actor-1', role: 'super_admin', session_version: 1 }, process.env.JWT_SECRET)
  const get = (authenticated = true) => fetch(`http://127.0.0.1:${server.address().port}/api/auth/ai-identity`, {
    headers: { ...(authenticated ? { authorization: `Bearer ${token}` } : {}), 'user-id': 'forged' },
  })
  try {
    assert.equal((await get(false)).status, 401)
    let response = await get()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await response.json(), { actor: { id: 'actor-1', role: 'analyst' } })
    account = { ...account, role: 'super_admin' }
    assert.equal((await (await get()).json()).actor.role, 'super_admin')
    account = { ...account, role: 'staff' }
    assert.equal((await get()).status, 403)
    account = { ...account, role: 'analyst', session_version: 2 }
    assert.equal((await get()).status, 401)
    account = { ...account, session_version: 1, is_active: false }
    assert.equal((await get()).status, 401)
    unavailable = true
    assert.equal((await get()).status, 503)
  } finally {
    await new Promise(resolve => server.close(resolve))
  }
})
