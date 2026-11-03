import assert from 'node:assert/strict'
import { access } from 'node:fs/promises'

// Offline image verification: no live connections or credentials.
assert.notEqual(process.getuid(), 0)
for (const path of ['/workspace/runtime', '/workspace/.env', '/workspace/apps/dashboard-api/.env']) {
  await assert.rejects(access(path))
}
Object.assign(process.env, {
  CORS_ORIGIN_DASHBOARD: 'http://localhost:5180', JWT_SECRET: 'image-test-only',
  JWT_EXPIRES: '1h', DASHBOARD_ADMIN_EMAIL: 'image@test.invalid',
  DASHBOARD_ADMIN_PASSWORD: 'image-test-only', POSTGRES_HOST: 'unused',
  POSTGRES_PORT: '5432', POSTGRES_DB: 'unused', POSTGRES_USER: 'unused',
  POSTGRES_PASSWORD: 'unused',
})
const { createApp } = await import('/workspace/apps/dashboard-api/src/app.js')
const { closeDatabase } = await import('/workspace/apps/dashboard-api/src/db.js')
try {
  assert.equal(typeof createApp(), 'function')
  await access('/workspace/analytics/metadata')
  await access('/workspace/analytics/sql')
  await access('/workspace/infra/bootstrap/bootstrap-handoff.mjs')
  console.log('PASS: non-root API starts with analytics assets and no runtime env')
} finally {
  await closeDatabase()
}
