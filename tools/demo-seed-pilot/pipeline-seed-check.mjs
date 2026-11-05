// Full-fixture integration check, restricted to the existing isolated local pilot.
import { spawn, spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const [manifest, fixture, ...extra] = process.argv.slice(2)
if (!manifest || !fixture || extra.length) throw Error('Usage: node pipeline-seed-check.mjs <manifest.json> <fixture.json>')
const here = dirname(fileURLToPath(import.meta.url))
const container = 'funnelmetry-offline-demo-pilot-postgres'
// The name matches the production target guard, but the inspected container is
// strictly offline and this database is created only when absent.
const database = 'funnelmetry_handoff'
function docker(args, input) {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  if (r.error || r.status !== 0) throw Error(`docker_${args[0]}_failed:${r.stderr}`)
  return r.stdout.trim()
}
const c = JSON.parse(docker(['inspect', container]))[0]
if (c.Config?.Labels?.['funnelmetry.purpose'] !== 'offline-demo-pilot-v1' ||
    c.HostConfig?.NetworkMode !== 'none' || Object.keys(c.HostConfig?.PortBindings ?? {}).length ||
    c.Mounts?.length !== 1 || c.Mounts[0].Name !== 'funnelmetry-offline-demo-pilot-data' || !c.State.Running) {
  throw Error('refusing_nonisolated_test_container')
}
function sql(statement) {
  return docker(['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'demo_owner', '-d', database, '-At'], statement)
}
async function load(expectSuccess) {
  const emitter = spawn(process.execPath, [resolve(here, 'pipeline-seed.mjs'), 'emit-sql', resolve(manifest), resolve(fixture)], { stdio: ['ignore', 'pipe', 'pipe'] })
  const psql = spawn('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'demo_owner', '-d', database], { stdio: ['pipe', 'ignore', 'pipe'] })
  let emitterErr = '', psqlErr = ''
  emitter.stderr.on('data', b => { emitterErr += b.toString() })
  psql.stderr.on('data', b => { psqlErr += b.toString() })
  psql.stdin.on('error', () => {})
  psql.on('close', () => { if (!emitter.stdout.destroyed) emitter.stdout.destroy() })
  emitter.stdout.pipe(psql.stdin)
  const closed = child => new Promise((resolveClosed, reject) => { child.once('error', reject); child.once('close', resolveClosed) })
  const [emitterCode, psqlCode] = await Promise.all([closed(emitter), closed(psql)])
  if (expectSuccess && (emitterCode !== 0 || psqlCode !== 0)) throw Error(`load_failed:${emitterCode}/${psqlCode}:${emitterErr}:${psqlErr}`)
  if (!expectSuccess && (psqlCode === 0 || !psqlErr.includes('dataset verification failed: sessions'))) {
    throw Error(`corrupt_replay_not_rejected:${emitterCode}/${psqlCode}:${psqlErr}`)
  }
}
let created = false
try {
  const wrongManifest = spawnSync(process.execPath, [resolve(here, 'pipeline-seed.mjs'), 'emit-sql', resolve(fixture), resolve(manifest)], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 })
  if (wrongManifest.status === 0 || wrongManifest.stdout.length !== 0 || !wrongManifest.stderr.includes('manifest_sha256_not_approved')) throw Error('wrong_manifest_not_rejected_before_output')
  const existing = docker(['exec', container, 'psql', '-X', '-q', '-U', 'demo_owner', '-d', 'postgres', '-Atc', "SELECT count(*) FROM pg_database WHERE datname='funnelmetry_handoff'"])
  if (existing !== '0') throw Error('offline_test_database_already_exists')
  docker(['exec', container, 'createdb', '-U', 'demo_owner', database])
  created = true
  const migration = await readFile(resolve(here, 'pipeline-demo-v1.sql'), 'utf8')
  sql(migration)
  sql(migration)
  await load(true)
  const before = JSON.parse(sql("SELECT json_build_object('sessions',(SELECT count(*) FROM demo_history.sessions),'events',(SELECT count(*) FROM demo_history.browser_events),'orders',(SELECT count(*) FROM demo_history.orders),'loaded_at',(SELECT loaded_at FROM demo_history.seed_manifest))::text;"))
  if (before.sessions !== 100000 || before.events !== 269430 || before.orders !== 2495) throw Error('counts_mismatch')
  await load(true)
  const after = JSON.parse(sql("SELECT json_build_object('sessions',(SELECT count(*) FROM demo_history.sessions),'events',(SELECT count(*) FROM demo_history.browser_events),'orders',(SELECT count(*) FROM demo_history.orders),'loaded_at',(SELECT loaded_at FROM demo_history.seed_manifest))::text;"))
  if (JSON.stringify(after) !== JSON.stringify(before)) throw Error('replay_changed_data_or_ingestion_time')
  sql("UPDATE demo_history.sessions SET device='CORRUPTED_TEST_VALUE' WHERE ordinal=1;")
  await load(false)
  const retained = sql('SELECT count(*) FROM demo_history.sessions;')
  if (retained !== '100000') throw Error('failed_replay_modified_count')
  console.log(JSON.stringify({ status: 'PASS', container, database, wrong_manifest: 'REJECTED', migration_replay: 'PASS', first_load: before, identical_replay: 'PASS', corrupted_replay: 'REJECTED' }))
} finally {
  if (created) docker(['exec', container, 'dropdb', '-U', 'demo_owner', database])
}
