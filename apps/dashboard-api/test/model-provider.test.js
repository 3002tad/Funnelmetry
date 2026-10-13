import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'

Object.assign(process.env, {
  PORT: '32000', CORS_ORIGIN_DASHBOARD: 'http://localhost:5180',
  JWT_SECRET: 'model-provider-test', JWT_EXPIRES: '1h',
  DASHBOARD_ADMIN_EMAIL: 'test@example.invalid', DASHBOARD_ADMIN_PASSWORD: 'test',
  POSTGRES_HOST: 'unused', POSTGRES_PORT: '5432', POSTGRES_DB: 'unused',
  POSTGRES_USER: 'unused', POSTGRES_PASSWORD: 'unused',
  DASHBOARD_ENABLE_AI: 'false', DASHBOARD_ENABLE_LEGACY: 'false',
})

const { inspectModelProvider, createModelProviderRouter } = await import('../src/routes/model-provider.js')
const validEnv = {
  DASHBOARD_ENABLE_QWEN: 'true',
  DASHSCOPE_API_KEY: 'private-test-key',
  DASHSCOPE_BASE_URL: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1',
}

test('provider inspection is local, explicit and never includes secret material', () => {
  assert.equal(inspectModelProvider({ DASHBOARD_ENABLE_QWEN: 'false' }).configuration_state, 'DISABLED')
  const configured = inspectModelProvider(validEnv)
  assert.equal(configured.configuration_state, 'CONFIGURED')
  assert.equal(configured.external_probe, false)
  assert.doesNotMatch(JSON.stringify(configured), /private-test-key|compatible-mode/)
  const invalid = inspectModelProvider({ ...validEnv, DASHSCOPE_BASE_URL: 'https://private-test-key.invalid' })
  assert.equal(invalid.configuration_state, 'INVALID')
  assert.equal(invalid.diagnostic_code, 'invalid_dashscope_endpoint')
  assert.doesNotMatch(JSON.stringify(invalid), /private-test-key/)
  assert.equal(inspectModelProvider({ ...validEnv, DASHSCOPE_API_KEY: '' }).diagnostic_code,
    'missing_or_invalid_dashscope_key')
})

test('provider status is admin-only, queryless and no-store', async () => {
  let role = 'analyst'
  const app = express()
  app.use(createModelProviderRouter({ execute: async () => [{ role, is_active: true, session_version: 1 }], env: validEnv }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const token = jwt.sign({ sub: 'admin', role: 'super_admin', session_version: 1 }, process.env.JWT_SECRET)
  const get = (suffix = '', auth = true) => fetch(`http://127.0.0.1:${server.address().port}/api/v2/admin/model-provider${suffix}`,
    { headers: auth ? { Authorization: `Bearer ${token}` } : {} })
  try {
    assert.equal((await get('', false)).status, 401)
    assert.equal((await get()).status, 403)
    role = 'super_admin'
    assert.equal((await get('?probe=true')).status, 400)
    const response = await get()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const body = await response.json()
    assert.equal(body.configuration_state, 'CONFIGURED')
    assert.equal(body.read_only, true)
    assert.equal(body.external_probe, false)
    assert.ok(body.checked_at)
    assert.doesNotMatch(JSON.stringify(body), /private-test-key|compatible-mode/)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
  }
})
