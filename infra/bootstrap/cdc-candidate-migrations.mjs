// CDC-11 candidate-only schema upgrade for an EXISTING Pipeline database.
// No source DB or active analytical binding is modified by these migrations.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createRequire } from 'node:module'
import path from 'node:path'

export const migrations = Object.freeze([
  { file: '021_catalog_cdc_candidate.sql', objects: [
    'catalog_cdc_products_current', 'catalog_cdc_variants_current',
    'catalog_cdc_categories_current', 'catalog_cdc_product_categories_current',
    'catalog_cdc_input_offsets', 'catalog_cdc_ingest_audit',
    'catalog_cdc_capture_status', 'catalog_cdc_quality_lease',
    'catalog_cdc_binding', 'current_product_reference_names_cdc',
  ] },
  { file: '022_inventory_price_cdc_context_candidate.sql', objects: [
    'inventory_price_cdc_context_current', 'inventory_price_cdc_input_offsets',
    'inventory_price_cdc_ingest_audit', 'inventory_price_cdc_capture_status',
    'inventory_price_cdc_quality_lease',
  ] },
  { file: '023_reference_order_cdc_v2_candidate.sql', objects: [
    'reference_cdc_v2_record_inbox', 'reference_cdc_v2_order_current_state',
    'reference_cdc_v2_sink_offsets', 'reference_cdc_v2_quality_state',
    'reference_cdc_v2_order_current_state_readable',
  ] },
])

export function migrationDigest(files) {
  if (files.length !== migrations.length) throw Error('cdc_migration_file_count_invalid')
  return createHash('sha256').update(JSON.stringify(files.map((file, index) =>
    [migrations[index].file, file]))).digest('hex')
}

export function assertTarget(env) {
  if (env.HANDOFF_MODE !== 'PARALLEL_LIVE' ||
      env.POSTGRES_HOST !== 'postgres' ||
      env.POSTGRES_DB !== 'funnelmetry_handoff' ||
      !env.POSTGRES_USER) throw Error('cdc_candidate_target_rejected')
}

async function inspect(client, digest, files) {
  const ready = await client.query(`SELECT status FROM handoff_bootstrap WHERE id=1`)
  if (ready.rows[0]?.status !== 'READY') throw Error('pipeline_bootstrap_not_ready')
  const journal = await client.query(`SELECT to_regclass('public.cdc_candidate_migration_journal') AS installed`)
  const existing = journal.rows[0]?.installed
  const state = existing ? await client.query(`SELECT file_name,content_sha256
    FROM cdc_candidate_migration_journal ORDER BY file_name`) : { rows: [] }
  if (existing && !state.rows.length) throw Error('cdc_candidate_empty_migration_journal')
  const byName = new Map(state.rows.map(row => [row.file_name, row.content_sha256]))
  if (byName.size !== state.rows.length || state.rows.length > migrations.length ||
      state.rows.some((row, index) => row.file_name !== migrations[index]?.file)) {
    throw Error('cdc_candidate_migration_journal_not_prefix')
  }
  for (let i = 0; i < migrations.length; i++) {
    const migration = migrations[i]
    const expected = createHash('sha256').update(files[i]).digest('hex')
    const applied = i < state.rows.length
    if (applied && byName.get(migration.file) !== expected) {
      throw Error('cdc_candidate_migration_checksum_drift')
    }
    for (const object of migration.objects) {
      const result = await client.query('SELECT to_regclass($1) AS relation', [`public.${object}`])
      const present = Boolean(result.rows[0]?.relation)
      if (applied ? !present : present) {
        throw Error('cdc_candidate_schema_ownership_or_drift')
      }
    }
  }
  return { status: state.rows.length === migrations.length ? 'ALREADY_APPLIED'
    : state.rows.length ? 'READY_TO_EXTEND' : 'READY_TO_APPLY',
  appliedCount: state.rows.length,
  pendingFiles: migrations.slice(state.rows.length).map(migration => migration.file), digest }
}

export async function runCandidateMigrations(client, files, mode, expectedDigest) {
  if (!['plan', 'apply'].includes(mode)) throw Error('cdc_candidate_mode_invalid')
  const digest = migrationDigest(files)
  if (mode === 'apply' && expectedDigest !== digest) {
    throw Error('cdc_candidate_reviewed_digest_mismatch')
  }
  // Serializes this migration tool with itself. Existing normal Pipeline
  // writes continue; candidate tables have no active consumer at this point.
  await client.query('BEGIN')
  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('funnelmetry-cdc11-candidate-migrations'))`)
    const before = await inspect(client, digest, files)
    if (mode === 'plan' || before.status === 'ALREADY_APPLIED') {
      await client.query('COMMIT')
      return before
    }
    if (before.appliedCount === 0) {
      await client.query(`CREATE TABLE cdc_candidate_migration_journal (
        file_name text PRIMARY KEY, content_sha256 text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`)
    }
    for (let i = before.appliedCount; i < migrations.length; i++) {
      await client.query(files[i])
      await client.query(`INSERT INTO cdc_candidate_migration_journal(file_name,content_sha256)
        VALUES($1,$2)`, [migrations[i].file,
        createHash('sha256').update(files[i]).digest('hex')])
    }
    await client.query('COMMIT')
    return { status: 'APPLIED_CANDIDATE_ONLY',
      appliedFiles: before.pendingFiles, digest }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  }
}

async function main() {
  const mode = process.argv[2]
  assertTarget(process.env)
  if (!['plan', 'apply'].includes(mode)) throw Error('usage: cdc-candidate-migrations.mjs plan|apply')
  if (mode === 'apply' && process.env.CDC_SHADOW_MIGRATION_ACK !== 'CDC11_CANDIDATE_ONLY') {
    throw Error('cdc_candidate_ack_missing')
  }
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../postgres/v2')
  const files = await Promise.all(migrations.map(migration =>
    readFile(path.join(root, migration.file), 'utf8')))
  const require = createRequire(path.resolve(root, '../../../apps/dashboard-api/package.json'))
  const { Client } = require('pg')
  const password = process.env.POSTGRES_PASSWORD_FILE
    ? readFileSync(process.env.POSTGRES_PASSWORD_FILE, 'utf8').trim()
    : process.env.POSTGRES_PASSWORD
  if (!password || (process.env.POSTGRES_PASSWORD_FILE && process.env.POSTGRES_PASSWORD)) {
    throw Error('cdc_candidate_db_credential_invalid')
  }
  const client = new Client({ host: 'postgres', database: 'funnelmetry_handoff',
    user: process.env.POSTGRES_USER, password, connectionTimeoutMillis: 10000 })
  await client.connect()
  try {
    const result = await runCandidateMigrations(client, files, mode,
      process.env.CDC_EXPECTED_MIGRATION_DIGEST)
    process.stdout.write(`${JSON.stringify(result)}\n`)
  } finally { await client.end() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`cdc-candidate-migrations: ${error.message}`)
    process.exitCode = 1
  })
}
