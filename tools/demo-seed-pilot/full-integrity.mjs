import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile,writeFile } from 'node:fs/promises'
import { resolve,dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { performance } from 'node:perf_hooks'

const dir=resolve(process.argv[2]??'')
const [reportRaw,manifestRaw,query]=await Promise.all([readFile(resolve(dir,'report.json'),'utf8'),readFile(resolve(dir,'manifest.json'),'utf8'),readFile(resolve(dirname(fileURLToPath(import.meta.url)),'full-integrity.sql'),'utf8')])
const report=JSON.parse(reportRaw),manifest=JSON.parse(manifestRaw),container='funnelmetry-offline-demo-pilot-postgres',db='funnelmetry_demo_100000_v2'
if(report.status!=='PASS'||report.database!==db||report.dataset_id!=='demo-historical-100000-v2'||report.logical_sha256!==manifest.logical_sha256||manifest.environment!=='OFFLINE_DEMO')throw Error('unexpected_manifest')
const inspect=spawnSync('docker',['inspect',container],{encoding:'utf8'});if(inspect.status!==0)throw Error('demo_container_missing')
const c=JSON.parse(inspect.stdout)[0]
if(c.Config.Labels?.['funnelmetry.purpose']!=='offline-demo-pilot-v1'||c.HostConfig.NetworkMode!=='none'||Object.keys(c.HostConfig.PortBindings??{}).length||c.Mounts.length!==1||c.Mounts[0].Name!=='funnelmetry-offline-demo-pilot-data')throw Error('target_not_isolated_demo')
const start=performance.now(),run=spawnSync('docker',['exec','-i',container,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','demo_owner','-d',db,'-At'],{input:query,encoding:'utf8',maxBuffer:5*1024*1024})
if(run.status!==0)throw Error(`sql_error:${run.stderr}`)
const results=JSON.parse(run.stdout.trim());if(Object.values(results).some(x=>x!==0))throw Error(`integrity_failed:${JSON.stringify(results)}`)
const evidence={status:'PASS',dataset_id:report.dataset_id,logical_sha256:report.logical_sha256,integrity_sql_sha256:createHash('sha256').update(query).digest('hex'),runtime_ms:Math.round(performance.now()-start),checks:results,environment:'OFFLINE_DEMO',note:'synthetic fixture only; no assertion about source CDC historical coverage'}
await writeFile(resolve(dir,'integrity.json'),JSON.stringify(evidence,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(evidence,null,2))
