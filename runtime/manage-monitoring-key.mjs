// Local operator CLI, never callable by the Agent/API. No secrets on command lines.
import { readFile, writeFile, rename, unlink, open, access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { parseEnv } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { rotateMonitoring } from './monitoring-rotation.mjs'

const root=fileURLToPath(new URL('../',import.meta.url))
const dir=new URL('monitoring/',import.meta.url)
const action=process.argv[2]
const idPattern=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
const read=name=>readFile(new URL(name,dir),'utf8')
const json=async name=>JSON.parse(await read(name))
const optional=async name=>{try{return await json(name)}catch(e){if(e.code==='ENOENT')return null;throw e}}
const atomic=async(name,value)=>{
  const temp=new URL(name+'.tmp',dir)
  await writeFile(temp,value,{mode:0o600})
  await rename(temp,new URL(name,dir))
}
let lock
let stage='local_state'
try {
  if(!['status','rotate','revoke'].includes(action))throw Error('Use status, rotate or revoke')
  lock=await open(new URL('key-operation.lock',dir),'wx',0o600)
  const current=await json('credential.json')
  if(!idPattern.test(current.id))throw Error('Invalid local credential ID')
  if(action==='status') {
    console.log(JSON.stringify({id:current.id,expires_at:current.expires_at,pending_rotation:!!await optional('rotation-pending.json'),scope:'local_receipt_not_server_authority'}))
  } else {
    const env=parseEnv(await readFile(new URL('demo-new.env',import.meta.url),'utf8'))
    const monitoring=parseEnv(await readFile(new URL('monitoring.env',import.meta.url),'utf8'))
    const port=Number(env.HANDOFF_UI_PORT),grafanaPort=Number(monitoring.MONITORING_GRAFANA_PORT||5182)
    if([port,grafanaPort].some(p=>!Number.isInteger(p)||p<1024||p>65535))throw Error('Invalid port')
    const base=`http://127.0.0.1:${port}`
    let session
    const api=async(path,options={})=>{
      const r=await fetch(base+path,{...options,redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',...(session?{Authorization:`Bearer ${session}`}:{})}})
      if(!r.ok)throw Error('Admin request failed')
      return r.status===204?null:r.json()
    }
    stage='admin_login_check_demo_running'
    session=(await api('/api/auth/login',{method:'POST',body:JSON.stringify({email:env.HANDOFF_ADMIN_EMAIL,password:env.HANDOFF_ADMIN_PASSWORD})})).token
    const revoke=async id=>{if(!idPattern.test(id))throw Error('Invalid ID');await api('/api/v2/admin/monitoring-credentials/'+id,{method:'DELETE'})}
    if(action==='revoke') {
      if(await optional('rotation-pending.json'))throw Error('Resolve pending rotation first')
      stage='revoke_current'
      await revoke(current.id)
      console.log('Current monitoring key revoked. Scraping will fail until a replacement is installed.')
    } else {
      const dockerCandidates=process.platform==='win32'?[join(process.env.LOCALAPPDATA||'', 'Programs/DockerDesktop/resources/bin/docker.exe'),join(process.env.ProgramFiles||'', 'Docker/Docker/resources/bin/docker.exe')]:['/usr/bin/docker','/usr/local/bin/docker']
      let docker
      for(const candidate of dockerCandidates){try{await access(candidate);docker=candidate;break}catch{}}
      if(!docker)throw Error('Docker not found')
      const args=['compose','-p','funnelmetry-demo-new','--env-file','runtime/demo-new.env','--env-file','runtime/monitoring.env']
      for(const file of ['handoff','handoff-pipeline','handoff-analytics','handoff-monitoring','observability'])args.push('-f',`infra/compose.${file}.yml`)
      const run=async extra=>promisify(execFile)(docker,[...args,...extra],{cwd:root,windowsHide:true,timeout:180000,maxBuffer:1024*1024})
      stage='compose_preflight'
      await run(['config','--quiet'])
      const password=await read('grafana-password')
      const headers={Authorization:'Basic '+Buffer.from('monitoring-admin:'+password).toString('base64')}
      let started
      const expires=await rotateMonitoring({
        current:async()=>current,
        loadPending:async()=>{
          const p=await optional('rotation-pending.json')
          if(p&&(!idPattern.test(p.previous_id)||!idPattern.test(p.replacement?.id)||p.previous_id===p.replacement.id||
            typeof p.replacement.token!=='string'||!p.replacement.token.startsWith(`fmmon_${p.replacement.id}.`)||
            ![p.previous_id,p.replacement.id].includes(current.id)))throw Error('Invalid pending rotation')
          return p
        },
        issue:()=>{stage='issue_replacement';return api('/api/v2/admin/monitoring-credentials',{method:'POST',body:JSON.stringify({label:'local-demo-prometheus',ttl_seconds:604800})})},
        savePending:p=>atomic('rotation-pending.json',JSON.stringify(p)),
        verify:async token=>{const r=await fetch(base+'/api/monitoring/metrics',{headers:{Authorization:`Bearer ${token}`},redirect:'error',signal:AbortSignal.timeout(15000)});if(!r.ok)throw Error('New key verification failed');await r.text()},
        install:token=>atomic('metrics-token',token),
        restart:async()=>{stage='restart_prometheus';started=Date.now();await run(['up','-d','--no-deps','--pull','never','--force-recreate','--wait','--wait-timeout','90','prometheus'])},
        freshScrape:async()=>{
          stage='verify_fresh_scrape'
          for(let i=0;i<30;i++){
            const r=await fetch(`http://127.0.0.1:${grafanaPort}/api/datasources/proxy/uid/funnelmetry-prometheus/api/v1/targets`,{headers,redirect:'error',signal:AbortSignal.timeout(5000)})
            if(!r.ok)throw Error('Cannot verify new scrape')
            const targets=(await r.json()).data?.activeTargets?.filter(t=>t.labels?.job==='funnelmetry-monitoring')
            if(targets?.length===1&&targets[0].health==='up'&&Date.parse(targets[0].lastScrape)>started)return
            await delay(2000)
          }
          throw Error('Fresh scrape not observed')
        },
        revoke:async id=>{stage='revoke_previous_or_unused';await revoke(id)},
        commit:receipt=>atomic('credential.json',JSON.stringify(receipt,null,2)),
        clearPending:()=>unlink(new URL('rotation-pending.json',dir)),
      })
      console.log(`Rotation complete: fresh scrape verified, previous key revoked. New expiry: ${expires}`)
    }
  }
} catch {
  console.error(`Key operation failed at ${stage}. Secrets not printed. Keep pending state; rerun rotate to resume. If lock exists after a crash, confirm no operation is running before removing that lock only.`)
  process.exitCode=1
} finally {
  if(lock){await lock.close();await unlink(new URL('key-operation.lock',dir))}
}
