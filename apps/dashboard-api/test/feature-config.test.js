import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'

const core = {
  PORT: '32000', CORS_ORIGIN_DASHBOARD: 'http://localhost:5180', JWT_SECRET: 'test-only',
  JWT_EXPIRES: '1h', DASHBOARD_ADMIN_EMAIL: 'admin@test.invalid', DASHBOARD_ADMIN_PASSWORD: 'test-only-password',
  POSTGRES_HOST: 'localhost', POSTGRES_PORT: '5432', POSTGRES_DB: 'test', POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test',
}
const ai = { QDRANT_URL: 'http://unused', QDRANT_COLLECTION: 'test', OLLAMA_URL: 'http://unused',
  OLLAMA_MODEL: 'test', OLLAMA_TIMEOUT_MS: '1000' }
function probe(extra = {}) {
  return spawnSync(process.execPath, ['--input-type=module', '-e',
    "import { config } from './src/config.js'; import { createApp } from './src/app.js'; createApp(); console.log(JSON.stringify(config.features));"], {
    cwd: new URL('..', import.meta.url), env: { ...core, ...extra }, encoding: 'utf8', timeout: 15000,
  })
}
test('core app imports without AI or legacy config; modules activate independently', () => {
  for (const [extra, expected] of [
    [{}, { legacy: false, ai: false }],
    [{ DASHBOARD_ENABLE_LEGACY: 'true', PIPELINE_TRACKING_API_URL: 'http://unused' }, { legacy: true, ai: false }],
    [{ DASHBOARD_ENABLE_AI: 'true', ...ai }, { legacy: false, ai: true }],
    [{ DASHBOARD_ENABLE_AI: 'true', DASHBOARD_ENABLE_LEGACY: 'true', PIPELINE_TRACKING_API_URL: 'http://unused', ...ai }, { legacy: true, ai: true }],
  ]) {
    const result = probe(extra)
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout.trim()), expected)
  }
})
test('enabled modules require their config and invalid feature flags fail closed', () => {
  for (const [extra, error] of [
    [{ DASHBOARD_ENABLE_AI: 'true' }, 'QDRANT_URL'],
    [{ DASHBOARD_ENABLE_LEGACY: 'true' }, 'PIPELINE_TRACKING_API_URL'],
    [{ DASHBOARD_ENABLE_AI: 'yes' }, 'DASHBOARD_ENABLE_AI must be true or false'],
    [{ DASHBOARD_ENABLE_LEGACY: '1' }, 'DASHBOARD_ENABLE_LEGACY must be true or false'],
  ]) {
    const result = probe(extra)
    assert.notEqual(result.status, 0)
    assert.ok(result.stderr.includes(error), result.stderr)
  }
})
