import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { assertTarget, migrationDigest, migrations,
  runCandidateMigrations } from './cdc-candidate-migrations.mjs'

const files = migrations.map((migration, index) => `-- candidate ${index + 1}: ${migration.file}`)

function clientWith(objects = new Set(), journal = null) {
  const statements = []
  return { statements, async query(sql, parameters = []) {
    statements.push({ sql, parameters })
    if (sql.includes('FROM handoff_bootstrap')) return { rows: [{ status: 'READY' }] }
    if (sql.includes('FROM cdc_candidate_migration_journal')) return { rows: journal ?? [] }
    if (sql.includes('to_regclass')) {
      const name = parameters[0]
      return { rows: [{ installed: name ? undefined : journal === null ? null : 'cdc_candidate_migration_journal',
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

test('CDC candidate extension accepts an exact journal prefix and only applies pending files', async () => {
  const applied = migrations.slice(0, 3)
  const objects = new Set(applied.flatMap(migration =>
    migration.objects.map(object => `public.${object}`)))
  const journal = applied.map((migration, index) => ({ file_name: migration.file,
    content_sha256: createHash('sha256').update(files[index]).digest('hex') }))
  const client = clientWith(objects, journal)
  const plan = await runCandidateMigrations(client, files, 'plan')
  assert.equal(plan.status, 'READY_TO_EXTEND')
  assert.deepEqual(plan.pendingFiles, migrations.slice(3).map(migration => migration.file))
  const appliedResult = await runCandidateMigrations(client, files, 'apply', migrationDigest(files))
  assert.deepEqual(appliedResult.appliedFiles, migrations.slice(3).map(migration => migration.file))
  assert.equal(client.statements.filter(({sql}) => sql.startsWith('CREATE TABLE cdc_candidate_migration_journal')).length, 0)
  assert.equal(client.statements.filter(({sql}) => sql === files[3]).length, 1)
  assert.equal(client.statements.filter(({sql}) => sql === files[4]).length, 1)
  assert.equal(client.statements.filter(({sql}) => sql === files[5]).length, 1)
  assert.equal(client.statements.filter(({sql}) => sql === files[6]).length, 1)
  assert.equal(client.statements.filter(({sql}) => files.slice(0, 3).includes(sql)).length, 0)
})

test('CDC candidate extension from the target four-file journal adds the two pending age stores', async () => {
  const applied = migrations.slice(0, 4)
  const objects = new Set(applied.flatMap(migration =>
    migration.objects.map(object => `public.${object}`)))
  const journal = applied.map((migration, index) => ({ file_name: migration.file,
    content_sha256: createHash('sha256').update(files[index]).digest('hex') }))
  const client = clientWith(objects, journal)
  const plan = await runCandidateMigrations(client, files, 'plan')
  assert.deepEqual(plan.pendingFiles, migrations.slice(4).map(migration => migration.file))
  const appliedResult = await runCandidateMigrations(client, files, 'apply', migrationDigest(files))
  assert.deepEqual(appliedResult.appliedFiles, migrations.slice(4).map(migration => migration.file))
  assert.equal(client.statements.filter(({sql}) => sql === files[4]).length, 1)
  assert.equal(client.statements.filter(({sql}) => sql === files[5]).length, 1)
  assert.equal(client.statements.filter(({sql}) => sql === files[6]).length, 1)
  assert.equal(client.statements.filter(({sql}) => files.slice(0, 4).includes(sql)).length, 0)
})

test('CDC candidate extension from the target five-file journal adds projection pending age only', async () => {
  const applied = migrations.slice(0, 5)
  const objects = new Set(applied.flatMap(migration =>
    migration.objects.map(object => `public.${object}`)))
  const journal = applied.map((migration, index) => ({ file_name: migration.file,
    content_sha256: createHash('sha256').update(files[index]).digest('hex') }))
  const client = clientWith(objects, journal)
  const plan = await runCandidateMigrations(client, files, 'plan')
  assert.deepEqual(plan.pendingFiles, migrations.slice(5).map(migration => migration.file))
  const result = await runCandidateMigrations(client, files, 'apply', migrationDigest(files))
  assert.deepEqual(result.appliedFiles, migrations.slice(5).map(migration => migration.file))
  assert.equal(client.statements.filter(({sql}) => sql === files[5]).length, 1)
  assert.equal(client.statements.filter(({sql}) => sql === files[6]).length, 1)
  assert.equal(client.statements.filter(({sql}) => files.slice(0, 5).includes(sql)).length, 0)
})

test('target six-file journal adds only the independent reference profile schema', async () => {
  const applied = migrations.slice(0, 6)
  const objects = new Set(applied.flatMap(migration =>
    migration.objects.map(object => `public.${object}`)))
  const journal = applied.map((migration, index) => ({ file_name: migration.file,
    content_sha256: createHash('sha256').update(files[index]).digest('hex') }))
  const client = clientWith(objects, journal)
  const plan = await runCandidateMigrations(client, files, 'plan')
  assert.deepEqual(plan.pendingFiles, ['028_reference_cdc_v2_profile_candidate.sql'])
  const result = await runCandidateMigrations(client, files, 'apply', migrationDigest(files))
  assert.deepEqual(result.appliedFiles, ['028_reference_cdc_v2_profile_candidate.sql'])
  assert.equal(client.statements.filter(({sql}) => sql === files[6]).length, 1)
  assert.equal(client.statements.filter(({sql}) => files.slice(0, 6).includes(sql)).length, 0)
})

test('CDC candidate extension rejects missing earlier migration and changed checksum', async () => {
  const objects = new Set(migrations[0].objects.map(object => `public.${object}`))
  const changed = clientWith(objects, [{file_name:migrations[0].file,content_sha256:'wrong'}])
  await assert.rejects(runCandidateMigrations(changed, files, 'plan'),
    /cdc_candidate_migration_checksum_drift/)
  const skipped = clientWith(objects, [{file_name:migrations[1].file,
    content_sha256:createHash('sha256').update(files[1]).digest('hex')}])
  await assert.rejects(runCandidateMigrations(skipped, files, 'plan'),
    /cdc_candidate_migration_journal_not_prefix/)
})

test('CDC candidate migration refuses an unowned preexisting projection object', async () => {
  const client = clientWith(new Set(['public.catalog_cdc_products_current']))
  await assert.rejects(runCandidateMigrations(client, files, 'apply', migrationDigest(files)),
    /cdc_candidate_schema_ownership_or_drift/)
  assert.equal(client.statements.at(-1).sql, 'ROLLBACK')
  assert.ok(client.statements.every(({ sql }) => !sql.startsWith('CREATE') && !sql.startsWith('INSERT')))
})
