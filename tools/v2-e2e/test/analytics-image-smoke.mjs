import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'

// Offline import/package probe. No external services, volumes or real secrets.
assert.notEqual(process.getuid(), 0)
for (const path of ['/workspace/runtime', '/workspace/.env', '/workspace/apps/dashboard-api/.env']) {
  await assert.rejects(access(path))
}
Object.assign(process.env, { CORS_ORIGIN_DASHBOARD: 'http://localhost:5180',
  JWT_SECRET: 'image-test-only', JWT_EXPIRES: '1h', DASHBOARD_ADMIN_EMAIL: 'image@test.invalid',
  DASHBOARD_ADMIN_PASSWORD: 'image-test-only', POSTGRES_HOST: 'unused', POSTGRES_PORT: '5432',
  POSTGRES_DB: 'unused', POSTGRES_USER: 'unused', POSTGRES_PASSWORD: 'unused' })
const { createApp } = await import('/workspace/apps/dashboard-api/src/app.js')
const { closeDatabase } = await import('/workspace/apps/dashboard-api/src/db.js')
try {
  assert.equal(typeof createApp(), 'function')
  const { createStagingAnalysisRunner } = await import('/workspace/analytics/src/analysis-run.mjs')
  const { discoverStagingOrderTool } = await import('/workspace/analytics/src/semantic-registry.mjs')
  assert.equal(typeof createStagingAnalysisRunner, 'function')
  assert.equal(typeof discoverStagingOrderTool, 'function')
  const metadata = JSON.parse(await readFile('/workspace/analytics/metadata/order-value-v1.json', 'utf8'))
  assert.equal(metadata.asset.id, 'asset.fact_order')
  for (const file of ['fact-order-v1.sql', 'catalog-v1.sql', 'evidence-v1.sql', 'product-value-v1.sql']) {
    assert.ok((await readFile(`/workspace/analytics/sql/${file}`, 'utf8')).length)
  }
  assert.ok(JSON.parse(await readFile('/workspace/integrations/medusa/canonical-mappings.v1.json', 'utf8')))
  await access('/workspace/infra/docker/bootstrap-handoff.mjs')
  await access('/workspace/infra/postgres/v2/020_product_reference.sql')
  console.log('PASS: non-root API + analytics imports, metadata, SQL; no runtime env directory')
} finally { await closeDatabase() }
