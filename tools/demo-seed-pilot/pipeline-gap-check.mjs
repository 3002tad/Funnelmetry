// Verify pinned gap fixture and its live binding using disposable PostgreSQL.
import { randomBytes } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const [manifest,fixture] = process.argv.slice(2)
if (!manifest || !fixture) throw Error('usage: node pipeline-gap-check.mjs <manifest> <fixture>')
const here=dirname(fileURLToPath(import.meta.url)), name=`funnelmetry-gap-test-${randomBytes(5).toString('hex')}`
function run(cmd,args,input,ok=true) { const r=spawnSync(cmd,args,{input,encoding:'utf8',maxBuffer:48*1024*1024}); if(r.error||(ok&&r.status!==0))throw Error(`${cmd}_failed:${r.error?.message??r.stderr}`); return r }
function sql(input,ok=true) { return run('docker',['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','funnelmetry_handoff','-At'],input,ok) }
let created=false
try {
 run('docker',['run','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data:rw,size=256m','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=funnelmetry_handoff','postgres:15-alpine']);created=true
 for(let n=0;n<60;n++){if(run('docker',['exec',name,'pg_isready','-U','postgres','-d','funnelmetry_handoff'],undefined,false).status===0 && run('docker',['logs',name],undefined,false).stderr.includes('database system is ready to accept connections'))break; await new Promise(r=>setTimeout(r,500));if(n===59)throw Error('postgres_not_ready')}
 sql(await readFile(resolve(here,'pipeline-demo-v1.sql'),'utf8'))
 sql(`CREATE ROLE funnelmetry_ai_agent; CREATE SCHEMA funnelmetry_explore; CREATE TABLE funnelmetry_explore.behavior_events(canonical_event_id text,source_id text,event_type text,occurred_at timestamptz,ingested_at timestamptz,query_normalized text,quality_status text);
 INSERT INTO demo_history.seed_manifest(dataset_id,manifest_sha256,fixture_sha256,logical_sha256,manifest) VALUES ('demo-historical-100000-v2','test','5858034aa55353d166fb9c2eaeb21f84f0d966d96e79a69b78e6bc2041544e0b','074d25c357a598767e58175bd0b0b2932118b4f6461fdb85d99a50cdcd2b3230','{}');
 INSERT INTO demo_history.browser_events(dataset_id,ordinal,event_id,session_id,event_type,occurred_at,data) VALUES ('demo-historical-100000-v2',1,'historic','session','behavior.page_viewed','2026-10-31 23:59:59+00','{}');`)
 sql(await readFile(resolve(here,'pipeline-analytical-views-v1.sql'),'utf8'))
 const seed=run('node',[resolve(here,'pipeline-seed.mjs'),'emit-sql',resolve(manifest),resolve(fixture)]).stdout
 sql(seed);sql(seed)
 const binding=await readFile(resolve(here,'pipeline-gap-binding-v1.sql'),'utf8')
 sql(binding);sql(binding)
 sql(await readFile(resolve(here,'pipeline-analytical-views-v1.sql'),'utf8'))
 if(sql("SELECT count(*) FROM funnelmetry_demo.sessions WHERE dataset_id='demo-gap-20261101-20261105-v1';").stdout.trim()!=='1750')throw Error('base_migration_lost_gap')
 if(sql('SET ROLE funnelmetry_ai_agent; SELECT demo_status FROM funnelmetry_demo.gap_dataset_coverage;').stdout.trim()!=='READY_FOR_DEMO')throw Error('gap_not_ready')
 const got=JSON.parse(sql(`SET ROLE funnelmetry_ai_agent; SELECT json_build_object('sessions',(SELECT count(*) FROM funnelmetry_demo.sessions),'events',(SELECT count(*) FROM funnelmetry_demo.browser_events),'overlap',(SELECT observed_overlap_count FROM funnelmetry_demo.gap_overlap_status),'orphans',(SELECT count(*) FROM funnelmetry_demo.browser_events e LEFT JOIN funnelmetry_demo.sessions s ON s.dataset_id=e.dataset_id AND s.session_id=e.session_id WHERE e.dataset_id='demo-gap-20261101-20261105-v1' AND s.session_id IS NULL))::text;`).stdout.trim())
 if(got.sessions!==1750 || got.events!==4985 || got.overlap!==0 || got.orphans!==0)throw Error(`fixture_integrity:${JSON.stringify(got)}`)
 const invalid=JSON.parse(sql(`SET ROLE funnelmetry_ai_agent; SELECT json_build_object(
  'line_order',(SELECT count(*) FROM funnelmetry_demo.order_lines l LEFT JOIN funnelmetry_demo.orders o ON o.dataset_id=l.dataset_id AND o.order_id=l.order_id WHERE l.dataset_id='demo-gap-20261101-20261105-v1' AND o.order_id IS NULL),
  'line_price',(SELECT count(*) FROM funnelmetry_demo.order_lines l WHERE l.dataset_id='demo-gap-20261101-20261105-v1' AND NOT EXISTS (SELECT 1 FROM funnelmetry_demo.offer_prices p WHERE p.dataset_id=l.dataset_id AND p.variant_key=l.variant_key AND p.price_rule=l.price_rule AND p.effective_at<=l.ordered_at AND l.ordered_at<p.valid_to AND p.amount_minor=l.unit_amount_minor)),
  'event_time',(SELECT count(*) FROM funnelmetry_demo.browser_events e JOIN funnelmetry_demo.sessions s ON s.dataset_id=e.dataset_id AND s.session_id=e.session_id WHERE e.dataset_id='demo-gap-20261101-20261105-v1' AND (e.occurred_at<s.started_at OR e.occurred_at>s.ended_at OR e.occurred_at >= '2026-11-05 00:00:00+00')),
  'missing_days',(SELECT count(*) FROM generate_series('2026-11-01'::date,'2026-11-04'::date,'1 day') d WHERE NOT EXISTS (SELECT 1 FROM funnelmetry_demo.sessions s WHERE s.dataset_id='demo-gap-20261101-20261105-v1' AND s.started_at>=d AND s.started_at<d+interval '1 day')) )::text;`).stdout.trim())
 if(Object.values(invalid).some(n=>n!==0))throw Error(`relationships_or_time_invalid:${JSON.stringify(invalid)}`)
 if(sql('SET ROLE funnelmetry_ai_agent; DELETE FROM funnelmetry_demo.sessions;',false).status===0)throw Error('write_not_denied')
 sql("INSERT INTO funnelmetry_explore.behavior_events VALUES ('late','medusa','behavior.page_viewed','2026-11-03 00:00:00+00',now(),NULL,'UNVERIFIED'),('current','medusa','behavior.page_viewed','2026-11-05 00:00:00+00',now(),NULL,'UNVERIFIED');")
 if(sql('SELECT overlap_status FROM funnelmetry_demo.gap_overlap_status;').stdout.trim()!=='LATE_OBSERVED_OVERLAP')throw Error('late_event_not_detected')
 if(sql(binding,false).status===0)throw Error('overlap_guard_failed')
 if(sql("SELECT count(*) FROM funnelmetry_demo.behavior_events_all WHERE event_id='current';").stdout.trim()!=='1')throw Error('current_event_missing')
 console.log(JSON.stringify({status:'PASS',replay:'PASS',integrity:got,late_overlap:'DETECTED',write:'DENIED'}))
} finally { if(created)run('docker',['rm','-f',name],undefined,false) }
