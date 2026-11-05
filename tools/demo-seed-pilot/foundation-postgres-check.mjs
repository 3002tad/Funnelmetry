// Isolated disposable PostgreSQL; never connects to the application database.
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here=dirname(fileURLToPath(import.meta.url))
const [fixtureDir,foundationDir]=process.argv.slice(2)
if (!fixtureDir || !foundationDir) throw Error('Usage: foundation-postgres-check.mjs <fixture-dir> <foundation-dir>')
const checked=spawnSync(process.execPath,[resolve(here,'foundation-cli.mjs'),'verify',fixtureDir,foundationDir],{encoding:'utf8'})
if (checked.status!==0) throw Error(`foundation_verification_failed: ${checked.stderr}`)
const [schema,raw,manifestRaw]=await Promise.all([readFile(resolve(here,'foundation.sql'),'utf8'),readFile(resolve(foundationDir,'foundation.json'),'utf8'),readFile(resolve(foundationDir,'manifest.json'),'utf8')])
const data=JSON.parse(raw), manifest=JSON.parse(manifestRaw)
const quote=v=>v==null?'NULL':typeof v==='number'?String(v):`'${String(v).replaceAll("'","''")}'`
const json=v=>`${quote(JSON.stringify(v))}::jsonb`
const fields=['dataset_id','entity_type','demo_entity_key','source_id','source_entity_id','valid_from','valid_to','origin','mapping_status','mapping_evidence']
const cfields=['dataset_id','domain','source_id','coverage_epoch_id','interval_start','interval_end','status','origin','evidence','source_checkpoint']
const insert=`INSERT INTO funnelmetry_demo_seed.dataset_manifest(dataset_id,seed_version,seed,environment,cutover_at,cutover_status,fixture_logical_sha256,foundation_logical_sha256,manifest) VALUES (${quote(data.dataset_id)},${quote(manifest.seed_version)},${manifest.seed},'OFFLINE_DEMO',${quote(data.cutover_at)},'PROVISIONAL_OFFLINE_ONLY',${quote(manifest.fixture_logical_sha256)},${quote(manifest.foundation_logical_sha256)},${json(manifest)}) ON CONFLICT DO NOTHING;\n`+
  data.crosswalk.map(r=>`INSERT INTO funnelmetry_demo_seed.entity_crosswalk(${fields.join(',')}) VALUES (${fields.map(k=>quote(r[k])).join(',')}) ON CONFLICT DO NOTHING;`).join('\n')+'\n'+
  data.coverage.map(r=>`INSERT INTO funnelmetry_demo_seed.coverage_interval(${cfields.join(',')}) VALUES (${cfields.map(k=>quote(r[k])).join(',')}) ON CONFLICT DO NOTHING;`).join('\n')
const name=`funnelmetry-foundation-${randomUUID().slice(0,8)}`
const run=(args,input,allowFail=false)=>{
  const r=spawnSync('docker',args,{input,encoding:'utf8',maxBuffer:4*1024*1024})
  if (r.error || (r.status!==0 && !allowFail)) throw Error(`docker ${args[0]} failed: ${r.error?.message??r.stderr}`)
  return r
}
const sql=(statement,allowFail=false)=>run(['exec','-i',name,'psql','-X','-q','-U','postgres','-d','foundation_test','-v','ON_ERROR_STOP=1','-At'],statement,allowFail)
let started=false
try {
  run(['run','-d','--rm','--network','none','--name',name,'-e','POSTGRES_PASSWORD=disposable-foundation-only','-e','POSTGRES_DB=foundation_test','postgres:15-alpine'])
  started=true
  let ready=false
  for(let i=0;i<30;i++) {
    const logs=run(['logs',name],undefined,true)
    const check=run(['exec',name,'pg_isready','-U','postgres','-d','foundation_test'],undefined,true)
    if ((logs.stdout+logs.stderr).includes('PostgreSQL init process complete') && check.status===0) { ready=true; break }
    await new Promise(r=>setTimeout(r,1000))
  }
  if(!ready) throw Error('temporary_postgres_not_ready')
  sql(schema)
  sql(`BEGIN;\n${insert}\nCOMMIT;`)
  const countSql="SELECT json_build_object('crosswalk',(SELECT count(*) FROM funnelmetry_demo_seed.entity_crosswalk),'coverage',(SELECT count(*) FROM funnelmetry_demo_seed.coverage_interval),'live_verified',(SELECT count(*) FROM funnelmetry_demo_seed.coverage_interval WHERE origin='OBSERVED_SOURCE' AND status='COMPLETE'),'synthetic_complete',(SELECT count(*) FROM funnelmetry_demo_seed.coverage_interval WHERE origin='SYNTHETIC_BACKFILL' AND status='COMPLETE'));"
  const first=JSON.parse(sql(countSql).stdout.trim())
  sql(`BEGIN;\n${insert}\nCOMMIT;`)
  const second=JSON.parse(sql(countSql).stdout.trim())
  if(JSON.stringify(first)!==JSON.stringify(second)||first.crosswalk!==data.crosswalk.length||first.coverage!==data.coverage.length||first.live_verified!==0||first.synthetic_complete!==4) throw Error('foundation_count_or_replay_mismatch')
  const row=data.crosswalk[0], coverage=data.coverage[0]
  const overlap=sql(`INSERT INTO funnelmetry_demo_seed.entity_crosswalk (${fields.join(',')}) VALUES (${fields.map(k=>quote(k==='demo_entity_key'?`${row.demo_entity_key}:conflict`:k==='valid_from'?'2026-01-01T00:00:00Z':rval(row,k))).join(',')});`,true)
  function rval(obj,k){return obj[k]}
  if(overlap.status===0 || !overlap.stderr.includes('exclusion constraint')) throw Error('overlap_not_rejected')
  const overlapCoverage=sql(`INSERT INTO funnelmetry_demo_seed.coverage_interval (${cfields.join(',')}) VALUES (${cfields.map(k=>quote(k==='interval_start'?'2026-01-01T00:00:00Z':coverage[k])).join(',')});`,true)
  if(overlapCoverage.status===0 || !overlapCoverage.stderr.includes('exclusion constraint')) throw Error('coverage_overlap_not_rejected')
  const observed=data.coverage.find(r=>r.origin==='OBSERVED_SOURCE')
  const falseComplete=sql(`INSERT INTO funnelmetry_demo_seed.coverage_interval (${cfields.join(',')}) VALUES (${cfields.map(k=>quote(k==='coverage_epoch_id'?'unverified-attempt':k==='status'?'COMPLETE':observed[k])).join(',')});`,true)
  if(falseComplete.status===0 || !falseComplete.stderr.includes('check constraint')) throw Error('unverified_live_coverage_not_rejected')
  console.log(JSON.stringify({result:'PASS',isolation:'disposable PostgreSQL, no network/ports/volumes',rows:first,duplicate_replay:'PASS',overlapping_crosswalk:'REJECTED',overlapping_coverage:'REJECTED',live_complete_without_checkpoint:'REJECTED',scope:'synthetic fixture only'},null,2))
} finally { if(started) run(['stop','-t','2',name],undefined,true) }
