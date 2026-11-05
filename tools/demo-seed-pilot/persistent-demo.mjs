// Isolated local offline pilot only. Never accepts an arbitrary database endpoint.
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname,resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { addCatalogLabels,generateExpanded,hash } from './expanded.mjs'
import { generateExpanded as generatePreviousPilot } from './expanded-pilot-v2-snapshot.mjs'
import { schemas } from './expanded-schema.mjs'

const [action,anchorPath,dir,labelsPath]=process.argv.slice(2)
if(!['seed','verify'].includes(action)||!anchorPath||!dir||!labelsPath)throw Error('Usage: persistent-demo.mjs seed|verify <anchor> <fixture-dir> <labels>')
const [anchorRaw,fixtureRaw,manifestRaw,labelsRaw,generatorRaw,previousRaw]=await Promise.all([readFile(resolve(anchorPath)),readFile(resolve(dir,'fixture.json')),readFile(resolve(dir,'manifest.json'),'utf8'),readFile(resolve(labelsPath)),readFile(resolve(dirname(fileURLToPath(import.meta.url)),'expanded.mjs')),readFile(resolve(dirname(fileURLToPath(import.meta.url)),'expanded-pilot-v2-snapshot.mjs'))])
const sha=x=>createHash('sha256').update(x).digest('hex'),manifest=JSON.parse(manifestRaw),data=JSON.parse(fixtureRaw),anchor=addCatalogLabels(JSON.parse(anchorRaw),JSON.parse(labelsRaw.toString('utf8').replace(/^\uFEFF/,'')))
const generator=manifest.generator_sha256===sha(generatorRaw)?generateExpanded:manifest.generator_sha256===sha(previousRaw)?generatePreviousPilot:null
if(manifest.environment!=='OFFLINE_DEMO'||manifest.anchor_sha256!==sha(anchorRaw)||manifest.labels_sha256!==sha(labelsRaw)||!generator||manifest.fixture_sha256!==sha(fixtureRaw)||manifest.logical_sha256!==hash(data)||manifest.logical_sha256!==hash(generator(anchor,data.config))||JSON.stringify(Object.keys(schemas).sort())!==JSON.stringify(Object.keys(data.rows).sort()))throw Error('fixture_verification_failed')
const container='funnelmetry-offline-demo-pilot-postgres',volume='funnelmetry-offline-demo-pilot-data',label='funnelmetry.purpose',labelValue='offline-demo-pilot-v1',q=x=>`'${String(x).replaceAll("'","''")}'`
function docker(args,input,allowed=false){const r=spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:80*1024*1024});if(r.error||(!allowed&&r.status!==0))throw Error(`docker ${args[0]} failed: ${r.error?.message??r.stderr}`);return r}
function inspect(args){const r=docker(args,undefined,true);return r.status===0?JSON.parse(r.stdout)[0]:null}
function validateVolume(v){if(!v||v.Name!==volume||v.Labels?.[label]!==labelValue)throw Error('existing_volume_not_owned_by_offline_demo')}
function validateContainer(c){const mounts=c?.Mounts??[];if(!c||c.Name!==`/${container}`||c.Config?.Labels?.[label]!==labelValue||c.HostConfig?.NetworkMode!=='none'||Object.keys(c.HostConfig?.PortBindings??{}).length||mounts.length!==1||mounts[0].Type!=='volume'||mounts[0].Name!==volume||mounts[0].Destination!=='/var/lib/postgresql/data')throw Error('existing_container_not_isolated_demo')}
let v=inspect(['volume','inspect',volume]),c=inspect(['inspect',container])
if(v)validateVolume(v)
if(c){if(!v)throw Error('container_volume_missing');validateContainer(c)}
if(action==='verify'&&(!v||!c))throw Error('demo_database_not_found')
if(action==='seed'&&!v){docker(['volume','create','--label',`${label}=${labelValue}`,volume]);v=inspect(['volume','inspect',volume]);validateVolume(v)}
if(action==='seed'&&!c){docker(['run','-d','--name',container,'--label',`${label}=${labelValue}`,'--network','none','--restart','unless-stopped','-e','POSTGRES_USER=demo_owner','-e','POSTGRES_DB=funnelmetry_demo','-e','POSTGRES_HOST_AUTH_METHOD=trust','--mount',`type=volume,source=${volume},target=/var/lib/postgresql/data`,'postgres:15-alpine']);c=inspect(['inspect',container]);validateContainer(c)}
if(!c.State.Running){if(action==='verify')throw Error('demo_database_not_running');docker(['start',container])}
let ready=false
for(let i=0;i<30;i++){const logs=docker(['logs',container],undefined,true),p=docker(['exec',container,'pg_isready','-U','demo_owner','-d','funnelmetry_demo'],undefined,true);if((logs.stdout+logs.stderr).includes('PostgreSQL init process complete')&&p.status===0){ready=true;break}await new Promise(r=>setTimeout(r,1000))}
if(!ready)throw Error('postgres_not_ready')
const sql=x=>docker(['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','demo_owner','-d','funnelmetry_demo','-At'],x).stdout.trim()
const schemaExists=sql("SELECT EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='demo');")==='t'
if(!schemaExists&&action==='verify')throw Error('demo_schema_missing')
if(!schemaExists){const views=Object.entries(schemas).map(([name,columns])=>`CREATE VIEW demo.${name} AS SELECT r.dataset_id,r.origin,r.loaded_at,t.* FROM demo.records r CROSS JOIN LATERAL jsonb_to_record(r.payload) AS t(${columns}) WHERE r.domain=${q(name)};`).join('\n');sql(`BEGIN; CREATE ROLE demo_reader NOLOGIN; REVOKE CREATE ON SCHEMA public FROM PUBLIC; CREATE SCHEMA demo; CREATE TABLE demo.manifest(dataset_id text PRIMARY KEY,logical_sha256 text NOT NULL,manifest jsonb NOT NULL,loaded_at timestamptz NOT NULL DEFAULT clock_timestamp()); CREATE TABLE demo.records(dataset_id text NOT NULL REFERENCES demo.manifest(dataset_id),domain text NOT NULL,ordinal int NOT NULL,origin text NOT NULL CHECK(origin='SYNTHETIC_BACKFILL'),payload jsonb NOT NULL,loaded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(dataset_id,domain,ordinal)); ${views} GRANT USAGE ON SCHEMA demo TO demo_reader; GRANT SELECT ON ALL TABLES IN SCHEMA demo TO demo_reader; COMMIT;`)}
const existing=sql(`SELECT logical_sha256 FROM demo.manifest WHERE dataset_id=${q(data.config.dataset_id)};`)
if(existing&&existing!==manifest.logical_sha256)throw Error('dataset_id_conflict_existing_manifest')
if(action==='verify'&&!existing)throw Error('dataset_not_seeded')
if(action==='seed'&&!existing){sql(`BEGIN; INSERT INTO demo.manifest(dataset_id,logical_sha256,manifest) VALUES(${q(data.config.dataset_id)},${q(manifest.logical_sha256)},${q(JSON.stringify(manifest))}::jsonb); INSERT INTO demo.records(dataset_id,domain,ordinal,origin,payload) SELECT ${q(data.config.dataset_id)},d.key,r.ordinality,'SYNTHETIC_BACKFILL',r.value FROM jsonb_each(${q(JSON.stringify(data.rows))}::jsonb) d CROSS JOIN LATERAL jsonb_array_elements(d.value) WITH ORDINALITY r(value,ordinality); COMMIT;`)}
const result=JSON.parse(sql(`SELECT json_build_object('manifest',(SELECT manifest FROM demo.manifest WHERE dataset_id=${q(data.config.dataset_id)}),'records',(SELECT json_object_agg(domain,items) FROM (SELECT domain,json_agg(payload ORDER BY ordinal) items FROM demo.records WHERE dataset_id=${q(data.config.dataset_id)} GROUP BY domain) d));`))
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x
const contentHash=x=>sha(JSON.stringify(stable(x)))
if(contentHash(result.manifest)!==contentHash(manifest)||contentHash(result.records)!==contentHash(data.rows))throw Error('database_content_checksum_mismatch')
const goldenSql=await readFile(resolve(dirname(fileURLToPath(import.meta.url)),'persistent-golden.sql'),'utf8')
const got=JSON.parse(sql(goldenSql))
const sum=(arr,pred,amount)=>arr.filter(pred).reduce((n,x)=>n+amount(x),0),r=data.rows
const expected={sessions:r.sessions.length,events:r.browser_events.length,product_views:r.browser_events.filter(x=>x.event_type==='behavior.product_viewed').length,searches:r.browser_events.filter(x=>x.event_type==='behavior.search_query_submitted').length,carts:new Set(r.cart_changes.map(x=>x.cart_id)).size,orders:r.orders.length,order_lines:r.order_lines.length,line_total_eur_minor:sum(r.order_lines,x=>x.currency==='EUR',x=>x.line_total_minor),captured_eur_minor:sum(r.payments,x=>x.currency==='EUR'&&x.action==='CAPTURED',x=>x.amount_minor),refunded_eur_minor:sum(r.payments,x=>x.currency==='EUR'&&x.action==='REFUNDED',x=>x.amount_minor),deleted_cart_lines:r.cart_changes.filter(x=>x.change_type==='DELETE').length,on_orders:r.orders.filter(x=>x.reference_state==='ON').length,category_product_views:sum(r.browser_events,x=>x.event_type==='behavior.product_viewed',e=>r.category_history.filter(h=>h.product_id===e.data.product_id&&h.valid_from<=e.occurred_at&&e.occurred_at<h.valid_to).length),invalid_order_price:0,can_read:true,can_insert:false}
if(JSON.stringify(got)!==JSON.stringify(expected))throw Error(`golden_question_mismatch ${JSON.stringify({got,expected})}`)
const denial=docker(['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','demo_owner','-d','funnelmetry_demo','-At'],'SET ROLE demo_reader; DELETE FROM demo.records;',true)
if(denial.status===0||!denial.stderr.includes('permission denied'))throw Error('read_only_role_write_not_denied')
c=inspect(['inspect',container]);validateContainer(c);validateVolume(inspect(['volume','inspect',volume]))
console.log(JSON.stringify({status:'PASS',environment:'OFFLINE_DEMO',container,volume,network:'none',published_ports:[],image_id:c.Image,dataset_id:data.config.dataset_id,fixture_sha256:manifest.fixture_sha256,logical_sha256:manifest.logical_sha256,database_content_sha256:contentHash(result.records),manifest_matches:true,golden_sql_sha256:sha(goldenSql),golden_questions:got,reader_write:'DENIED',live_cutover:'UNVERIFIED',source_cdc_history:'INCOMPLETE'},null,2))
