// Read-only acceptance helper; caller controls any deliberate worker stop/start.
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
const expected=process.argv[2]??'recovered'
if(!['unverified','recovered'].includes(expected))throw Error('Expected unverified or recovered')
const env=parseEnv(await readFile(new URL('demo-new.env',import.meta.url),'utf8'))
const base=`http://127.0.0.1:${Number(env.HANDOFF_UI_PORT)}`
try {
  const login=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:env.HANDOFF_ADMIN_EMAIL,password:env.HANDOFF_ADMIN_PASSWORD}),signal:AbortSignal.timeout(10000),redirect:'error'})
  if(!login.ok)throw Error('login')
  const token=(await login.json()).token
  const anon=await fetch(base+'/api/v2/admin/monitoring-alerts',{signal:AbortSignal.timeout(10000)})
  if(anon.status!==401)throw Error('anonymous')
  let passed=false
  for(let i=0;i<15;i++){
    const r=await fetch(base+'/api/v2/admin/monitoring-alerts',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000),redirect:'error'})
    if(!r.ok)throw Error('alerts')
    const data=await r.json()
    const worker=data.items.filter(i=>i.subject==='canonical-normalizer')
    if(expected==='unverified'?worker.some(i=>i.code==='WORKER_UNVERIFIED'):worker.length===0){passed=true;console.log(`PASS: canonical-normalizer ${expected}; scrape=${data.scrape.state}; anonymous=401`);break}
    await delay(2000)
  }
  if(!passed)throw Error('expected observation missing')
}catch{console.error('Alert acceptance failed; no secrets printed.');process.exitCode=1}
