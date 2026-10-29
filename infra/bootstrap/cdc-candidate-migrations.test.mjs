import assert from 'node:assert/strict'
import test from 'node:test'
import { assertTarget, migrationDigest, migrations,
  runCandidateMigrations } from './cdc-candidate-migrations.mjs'

const files = migrations.map((migration, index) => `-- candidate ${index + 1}: ${migration.file}`)

function clientWith(objects = new Set()) {
  const statements = []
  return { statements, async query(sql, parameters = []) {
    statements.push({ sql, parameters })
    if (sql.includes('FROM handoff_bootstrap')) return { rows: [{ status: 'READY' }] }
    if (sql.includes('to_regclass')) {
      const name = parameters[0]
      return { rows: [{ installed: name ? undefined : null,
        relation: name && objects.has(name) ? name : null }] }
    }
    return { rows: [] }
  } }
}

test('CDC candidate migration plan is read-only, scoped and checksum bound', async () => {
  assert.doesNotThrow(() => assertTarget({ HANDOFF_MODE: 'PARALLEL_LIVE',
    POSTGRES_HOST: 'postgres', POSTGRES_DB: 'funnelmetry_handoff', POSTGRES_USER: 'funnelmetry' }))
  assert.throws(() => assertTarget({ HANDOFF_MODE: 'OFFLINE_DEMO',
    POSTGRES_HOST: 'postgres', POSTGRES_DB: 'funnelmetry_handoff', POSTGRES_USER: 'funnelmetry' }),
  /cdc_candidate_target_rejected/)
  const client = clientWith()
  const plan = await runCandidateMigrations(client, files, 'plan')
  assert.equal(plan.status, 'READY_TO_APPLY')
  assert.equal(plan.digest, migrationDigest(files))
  assert.ok(client.statements.every(({ sql }) => !sql.startsWith('CREATE') && !sql.startsWith('INSERT')))
  const rejected = clientWith()
  await assert.rejects(runCandidateMigrations(rejected, files, 'apply', 'wrong'),
    /cdc_candidate_reviewed_digest_mismatch/)
  assert.equal(rejected.statements.length, 0)
})

test('CDC candidate migration refuses an unowned preexisting projection object', async () => {
  const client = clientWith(new Set(['public.catalog_cdc_products_current']))
  await assert.rejects(runCandidateMigrations(client, files, 'apply', migrationDigest(files)),
    /cdc_candidate_schema_ownership_or_drift/)
  assert.equal(client.statements.at(-1).sql, 'ROLLBACK')
  assert.ok(client.statements.every(({ sql }) => !sql.startsWith('CREATE') && !sql.startsWith('INSERT')))
})
