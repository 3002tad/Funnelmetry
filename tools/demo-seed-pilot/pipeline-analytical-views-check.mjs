// Small boundary/privilege test in a disposable, network-disabled PostgreSQL.
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { schemas } from './expanded-schema.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const name = `funnelmetry-demo-binding-test-${randomBytes(5).toString('hex')}`
function run(args, input, ok = true) {
  const r = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 })
  if (r.error || (ok && r.status !== 0)) throw Error(`docker_failed:${r.error?.message ?? r.stderr}`)
  return r
}
function sql(input, ok = true) {
  return run(['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','funnelmetry_handoff','-At'], input, ok)
}
let created = false
try {
  run(['run','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data:rw,size=128m','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=funnelmetry_handoff','postgres:15-alpine'])
  created = true
  let ready = false
  for (let i = 0; i < 40; i++) {
    const logs = run(['logs',name],undefined,false)
    const check = run(['exec',name,'pg_isready','-U','postgres','-d','funnelmetry_handoff'],undefined,false)
    if (check.status === 0 && (logs.stdout + logs.stderr).includes('PostgreSQL init process complete')) { ready=true; break }
    await new Promise(resolveWait => setTimeout(resolveWait,500))
  }
  if (!ready) throw Error('postgres_not_ready')
  const migration = await readFile(resolve(here,'pipeline-demo-v1.sql'),'utf8')
  const binding = await readFile(resolve(here,'pipeline-analytical-views-v1.sql'),'utf8')
  const coverage = await readFile(resolve(here,'pipeline-demo-coverage-v1.sql'),'utf8')
  sql(migration)
  sql(`CREATE ROLE funnelmetry_ai_agent; CREATE SCHEMA funnelmetry_explore;
    CREATE TABLE funnelmetry_explore.behavior_events(canonical_event_id text, source_id text, event_type text, occurred_at timestamptz, ingested_at timestamptz, query_normalized text, quality_status text);
    INSERT INTO funnelmetry_explore.behavior_events VALUES ('before','medusa-reference','behavior.page_viewed','2026-10-31 23:59:59+00',now(),NULL,'UNVERIFIED'), ('after','medusa-reference','behavior.page_viewed','2026-11-01 00:00:00+00',now(),NULL,'UNVERIFIED'), ('unrelated','medusa-reference','order.placed','2026-11-02 00:00:00+00',now(),NULL,'UNVERIFIED');
    INSERT INTO demo_history.seed_manifest(dataset_id,manifest_sha256,fixture_sha256,logical_sha256,manifest) VALUES ('demo-historical-100000-v2','test','5858034aa55353d166fb9c2eaeb21f84f0d966d96e79a69b78e6bc2041544e0b','074d25c357a598767e58175bd0b0b2932118b4f6461fdb85d99a50cdcd2b3230','{}');
    INSERT INTO demo_history.browser_events(dataset_id,ordinal,event_id,session_id,event_type,occurred_at,data) VALUES ('demo-historical-100000-v2',1,'synthetic','session','behavior.page_viewed','2026-10-31 23:00:00+00','{}');`)
  sql(binding)
  sql(binding)
  const result = sql(`SET ROLE funnelmetry_ai_agent;
    SELECT json_build_object('synthetic',count(*) FILTER (WHERE origin='SYNTHETIC_BACKFILL'), 'observed',count(*) FILTER (WHERE origin='OBSERVED_SOURCE'), 'before',count(*) FILTER (WHERE event_id='before'), 'unrelated',count(*) FILTER (WHERE event_id='unrelated'), 'quality',count(*) FILTER (WHERE quality_status='UNVERIFIED'), 'direct_source',has_schema_privilege(current_user,'demo_history','USAGE'))::text FROM funnelmetry_demo.behavior_events_all;`).stdout.trim()
  const actual = JSON.parse(result)
  if (actual.synthetic !== 1 || actual.observed !== 1 || actual.before !== 0 || actual.unrelated !== 0 || actual.quality !== 2 || actual.direct_source !== false) throw Error(`boundary_or_privilege_failure:${result}`)
  const denial = sql('SET ROLE funnelmetry_ai_agent; DELETE FROM funnelmetry_demo.sessions;', false)
  if (denial.status === 0 || !denial.stderr.includes('permission denied')) throw Error('write_was_not_denied')
  const manifest = JSON.stringify({config:{start:'2025-11-01T00:00:00Z',end:'2026-11-01T00:00:00Z'},counts:Object.fromEntries(Object.keys(schemas).map(k=>[k,k==='browser_events'?1:0]))})
  sql(`UPDATE demo_history.seed_manifest SET manifest_sha256='b4316f664d333ae05b2a804ff63bd513c776462e4effe08a4b9a74b869058d0f',manifest='${manifest}'::jsonb;`)
  sql(coverage)
  sql(coverage)
  if (sql('SET ROLE funnelmetry_ai_agent; SELECT demo_status FROM funnelmetry_demo.dataset_coverage;').stdout.trim() !== 'READY_FOR_DEMO') throw Error('demo_coverage_not_ready')
  sql("UPDATE demo_history.seed_manifest SET manifest=jsonb_set(manifest,'{counts,browser_events}','2');")
  if (sql('SET ROLE funnelmetry_ai_agent; SELECT demo_status FROM funnelmetry_demo.dataset_coverage;').stdout.trim() !== 'DEMO_DATA_MISMATCH') throw Error('coverage_does_not_detect_count_mismatch')
  console.log(JSON.stringify({status:'PASS', boundary:actual, replay:'PASS', write:'DENIED',demo_coverage:'PASS',mismatched_count:'DETECTED'}))
} finally {
  if (created) run(['rm','-f',name],undefined,false)
}
