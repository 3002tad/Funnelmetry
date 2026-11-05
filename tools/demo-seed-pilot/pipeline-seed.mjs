// Emits a psql transaction for a pinned DEC-150 synthetic fixture.
// stdout is SQL: pipe it directly to psql; do not print or commit the fixture.
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { once } from 'node:events'
import { resolve } from 'node:path'
import { schemas } from './expanded-schema.mjs'

const PINS = [Object.freeze({
  dataset: 'demo-historical-100000-v2',
  manifest: 'b4316f664d333ae05b2a804ff63bd513c776462e4effe08a4b9a74b869058d0f',
  fixture: '5858034aa55353d166fb9c2eaeb21f84f0d966d96e79a69b78e6bc2041544e0b',
  logical: '074d25c357a598767e58175bd0b0b2932118b4f6461fdb85d99a50cdcd2b3230',
  version: 'demo-scale-manifest.v1',
}), Object.freeze({
  dataset: 'demo-gap-20261101-20261105-v1',
  manifest: '09a559d8fe7cdf051c3260e6a29370eab849cd910c265478f5ed3129f897ca30',
  fixture: '6089a21874defb09b7641166481b8261e4313604f700686fbe3a23d9f4a41bd8',
  logical: '785ecd32bcd98d973a9485dc1cbb0d18b7035c893f6d7f0bb6b3c0281f9fa587',
  version: 'demo-gap-manifest.v1',
}), Object.freeze({
  dataset: 'demo-historical-100000-v3-utm',
  manifest: '395b7f6abcd4c405397dcc7db9b8ffac340c8b780d19303f06075ee1e47268e9',
  fixture: 'efa33fde6f86d3c1651ea54e0b1873374d79436def7b3f753f39e31c17a250de',
  logical: '5ce19fb7aff298c4779570ea09e5f5efc4da6c871d9f994e710b25f869a2e4a4',
  version: 'demo-utm-derived-manifest.v1',
}), Object.freeze({
  dataset: 'demo-gap-20261101-20261105-v2-utm',
  manifest: '8262898adfb0c73ff3b108c98264dc87d93129e1fef7e2148b095c6b2ae46881',
  fixture: '8df0119c34c5d13e71f506dcfbb9708e31b7f52fa50cadfc300fa91f18bfbdea',
  logical: 'ccf2011527e24068ad2037078f0f45378f6dcfdcc03f48d3934dfd49cde071ac',
  version: 'demo-utm-derived-manifest.v1',
})]
const sha = value => createHash('sha256').update(value).digest('hex')
const stable = x => Array.isArray(x) ? x.map(stable) : x && typeof x === 'object'
  ? Object.fromEntries(Object.keys(x).sort().map(k => [k, stable(x[k])])) : x
const literal = x => `'${String(x).replaceAll("'", "''")}'`
const [command, manifestPath, fixturePath, ...extra] = process.argv.slice(2)
if (!['check', 'emit-sql'].includes(command) || !manifestPath || !fixturePath || extra.length) {
  throw Error('Usage: node pipeline-seed.mjs check|emit-sql <manifest.json> <fixture.json>')
}

const [manifestRaw, fixtureRaw] = await Promise.all([readFile(resolve(manifestPath)), readFile(resolve(fixturePath))])
const PIN = PINS.find(pin => pin.manifest === sha(manifestRaw))
if (!PIN) throw Error('manifest_sha256_not_approved')
if (sha(fixtureRaw) !== PIN.fixture) throw Error('fixture_sha256_not_approved')
const manifest = JSON.parse(manifestRaw.toString('utf8'))
const fixture = JSON.parse(fixtureRaw.toString('utf8'))
if (manifest.manifest_version !== PIN.version || manifest.dataset_id !== PIN.dataset ||
    manifest.fixture_sha256 !== PIN.fixture || manifest.logical_sha256 !== PIN.logical ||
    manifest.origin !== 'SYNTHETIC_BACKFILL' || fixture.origin !== manifest.origin ||
    fixture.config?.dataset_id !== PIN.dataset || sha(JSON.stringify(fixture)) !== PIN.logical) {
  throw Error('manifest_fixture_identity_mismatch')
}
const domains = Object.keys(schemas)
const sameKeys = (a, b) => JSON.stringify(Object.keys(a).sort()) === JSON.stringify(Object.keys(b).sort())
if (!sameKeys(fixture.rows, schemas) || !sameKeys(manifest.counts, schemas) ||
    !sameKeys(manifest.domain_canonical_sha256, schemas)) throw Error('domain_set_mismatch')
for (const domain of domains) {
  const rows = fixture.rows[domain]
  const fields = schemas[domain].split(', ').map(c => c.split(' ')[0]).sort()
  if (!Array.isArray(rows) || rows.length !== manifest.counts[domain]) throw Error(`row_count_mismatch:${domain}`)
  const digest = createHash('sha256')
  for (const row of rows) {
    if (!row || Array.isArray(row) || JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(fields)) {
      throw Error(`field_set_mismatch:${domain}`)
    }
    digest.update(JSON.stringify(stable(row)) + '\n')
  }
  if (digest.digest('hex') !== manifest.domain_canonical_sha256[domain]) throw Error(`domain_checksum_mismatch:${domain}`)
}
if (command === 'check') {
  console.log(JSON.stringify({ status: 'PASS', dataset_id: PIN.dataset, fixture_sha256: PIN.fixture, domains: domains.length }))
  process.exit(0)
}

async function emit(s) {
  if (!process.stdout.write(s)) await once(process.stdout, 'drain')
}
await emit(`\\set ON_ERROR_STOP on\nBEGIN;\nSET LOCAL TIME ZONE 'UTC';\nSET LOCAL standard_conforming_strings = on;\nSELECT pg_advisory_xact_lock(hashtextextended('funnelmetry-demo-history-v1', 0));\n`)
await emit(`DO $target$ BEGIN IF current_database() <> 'funnelmetry_handoff' THEN RAISE EXCEPTION 'wrong database: expected funnelmetry_handoff'; END IF; END $target$;\n`)
await emit(`CREATE TEMP TABLE demo_seed_run_state ON COMMIT DROP AS SELECT NOT EXISTS (SELECT 1 FROM demo_history.seed_manifest WHERE dataset_id=${literal(PIN.dataset)}) AS is_new;\n`)
if (PIN.dataset.startsWith('demo-gap-')) {
  await emit(`DO $gap$ BEGIN IF (SELECT is_new FROM demo_seed_run_state) AND EXISTS (SELECT 1 FROM funnelmetry_explore.behavior_events WHERE occurred_at >= '2026-11-01T00:00:00Z' AND occurred_at < '2026-11-05T00:00:00Z') THEN RAISE EXCEPTION 'observed events overlap planned synthetic gap'; END IF; END $gap$;\n`)
}
await emit(`DO $guard$ BEGIN IF EXISTS (SELECT 1 FROM demo_history.seed_manifest WHERE dataset_id=${literal(PIN.dataset)} AND (manifest_sha256<>${literal(PIN.manifest)} OR fixture_sha256<>${literal(PIN.fixture)} OR logical_sha256<>${literal(PIN.logical)} OR manifest<>${literal(manifestRaw.toString('utf8'))}::jsonb)) THEN RAISE EXCEPTION 'existing dataset manifest differs'; END IF; END $guard$;\n`)
await emit(`INSERT INTO demo_history.seed_manifest(dataset_id,manifest_sha256,fixture_sha256,logical_sha256,manifest) VALUES (${literal(PIN.dataset)},${literal(PIN.manifest)},${literal(PIN.fixture)},${literal(PIN.logical)},${literal(manifestRaw.toString('utf8'))}::jsonb) ON CONFLICT (dataset_id) DO NOTHING;\n`)
for (const domain of domains) {
  const columns = schemas[domain].split(', ').map(c => c.split(' ')[0])
  const compare = ['dataset_id', 'ordinal', 'origin', ...columns].join(', ')
  await emit(`CREATE TEMP TABLE demo_seed_stage (LIKE demo_history.${domain} INCLUDING DEFAULTS) ON COMMIT DROP;\n`)
  const rows = fixture.rows[domain]
  for (let offset = 0; offset < rows.length; offset += 1000) {
    const batch = rows.slice(offset, offset + 1000)
    await emit(`INSERT INTO demo_seed_stage(${compare}) SELECT ${literal(PIN.dataset)}, (r.n + ${offset})::integer, 'SYNTHETIC_BACKFILL', ${columns.map(c => `v.${c}`).join(', ')} FROM jsonb_array_elements(${literal(JSON.stringify(batch))}::jsonb) WITH ORDINALITY AS r(value,n) CROSS JOIN LATERAL jsonb_to_record(r.value) AS v(${schemas[domain]});\n`)
  }
  await emit(`INSERT INTO demo_history.${domain}(${compare}) SELECT ${compare} FROM demo_seed_stage WHERE (SELECT is_new FROM demo_seed_run_state) ON CONFLICT (dataset_id,ordinal) DO NOTHING;\n`)
  await emit(`DO $verify$ BEGIN IF (SELECT count(*) FROM demo_history.${domain} WHERE dataset_id=${literal(PIN.dataset)}) <> ${rows.length} OR EXISTS (SELECT ${compare} FROM demo_seed_stage EXCEPT SELECT ${compare} FROM demo_history.${domain} WHERE dataset_id=${literal(PIN.dataset)}) OR EXISTS (SELECT ${compare} FROM demo_history.${domain} WHERE dataset_id=${literal(PIN.dataset)} EXCEPT SELECT ${compare} FROM demo_seed_stage) THEN RAISE EXCEPTION 'dataset verification failed: ${domain}'; END IF; END $verify$;\nDROP TABLE demo_seed_stage;\n`)
}
await emit(`COMMIT;\n`)
