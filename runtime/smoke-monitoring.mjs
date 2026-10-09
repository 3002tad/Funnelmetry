// Read/credential-lifecycle acceptance only; never touches events or cursor state.
import { readFile } from 'node:fs/promises'
import { parseEnv } from 'node:util'
import assert from 'node:assert/strict'
const env=parseEnv(await readFile(new URL('demo-new.env',import.meta.url),'utf8'))
const base=`http://127.0.0.1:${Number(env.HANDOFF_UI_PORT)}`
const request=(path,token,options={})=>fetch(base+path,{...options,redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})}})
let admin,issued
try {
  const login=await request('/api/auth/login',null,{method:'POST',body:JSON.stringify({email:env.HANDOFF_ADMIN_EMAIL,password:env.HANDOFF_ADMIN_PASSWORD})})
  assert.equal(login.status,200);admin=(await login.json()).token
  const create=await request('/api/v2/admin/monitoring-credentials',admin,{method:'POST',body:JSON.stringify({label:'acceptance-revoke',ttl_seconds:60})})
  assert.equal(create.status,201);issued=await create.json()
  assert.equal((await request('/api/monitoring/metrics')).status,401)
  assert.equal((await request('/api/monitoring/metrics',admin)).status,401)
  assert.equal((await request('/api/monitoring/metrics',issued.token)).status,200)
  for(const path of ['/api/auth/me','/api/v2/admin/monitoring-credentials','/api/v2/admin/processing'])
    assert.equal((await request(path,issued.token)).status,401)
  assert.equal((await request('/api/v2/admin/monitoring-credentials/'+issued.id,admin,{method:'DELETE'})).status,204)
  assert.equal((await request('/api/monitoring/metrics',issued.token)).status,401)
  assert.equal((await request('/api/v2/admin/monitoring-credentials/'+issued.id,admin,{method:'DELETE'})).status,204)
  console.log('PASS: machine metrics 200, anonymous/JWT denied, non-metrics APIs denied, revoke enforced and idempotent.')
} catch { console.error('Monitoring lifecycle smoke failed; no credentials printed.');process.exitCode=1 }
finally { if(issued&&admin) await request('/api/v2/admin/monitoring-credentials/'+issued.id,admin,{method:'DELETE'}).catch(()=>{console.error('Revoke cleanup failed');process.exitCode=1}) }
