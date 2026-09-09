import test from 'node:test'
import assert from 'node:assert/strict'
Object.assign(process.env, { PORT: '32000', CORS_ORIGIN_DASHBOARD: 'http://unused',
  JWT_SECRET: 'test-only', JWT_EXPIRES: '1h', DASHBOARD_ADMIN_EMAIL: 'a@b.test', DASHBOARD_ADMIN_PASSWORD: 'test-only',
  PIPELINE_TRACKING_API_URL: 'http://unused', POSTGRES_HOST: 'unused', POSTGRES_PORT: '5432',
  POSTGRES_DB: 'test', POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test', QDRANT_URL: 'http://unused',
  QDRANT_COLLECTION: 'test', OLLAMA_URL: 'http://unused', OLLAMA_MODEL: 'test', OLLAMA_TIMEOUT_MS: '1000' })
const { requireLiveSession } = await import('../src/middleware/live-session.js')

test('live sessions reject legacy tokens, revocations, disabled users and DB failures', async () => {
  for (const [version, row, expected] of [
    [undefined, { session_version: 0, is_active: true }, 401],
    [0, { session_version: 1, is_active: true }, 401],
    [0, { session_version: 0, is_active: false }, 401],
    [0, undefined, 401],
    [0, { session_version: 0, is_active: true, role: 'staff' }, 200],
    [0, 'outage', 503],
  ]) {
    let status = 200, passed = false
    const req = { user: { id: 'test', role: 'super_admin', session_version: version } }
    const res = { status(value) { status = value; return this }, json() {} }
    await requireLiveSession(async () => { if (row === 'outage') throw Error('private'); return row ? [row] : [] })(req, res, () => { passed = true })
    assert.equal(status, expected)
    assert.equal(passed, expected === 200)
    if (passed) assert.equal(req.user.role, 'staff')
  }
})
