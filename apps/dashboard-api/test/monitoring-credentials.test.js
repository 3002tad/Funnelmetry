import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
import { newMonitoringToken, verifyMonitoringToken, parseMonitoringIssue } from '../src/lib/monitoring-credentials.js'

Object.assign(process.env, { PORT: '32000', CORS_ORIGIN_DASHBOARD: 'http://localhost:5180',
  JWT_SECRET: 'monitoring-test-only', JWT_EXPIRES: '1h', DASHBOARD_ADMIN_EMAIL: 'admin@example.test',
  DASHBOARD_ADMIN_PASSWORD: 'test-only-password', PIPELINE_TRACKING_API_URL: 'http://unused',
  POSTGRES_HOST: 'unused', POSTGRES_PORT: '5432', POSTGRES_DB: 'test', POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test',
  QDRANT_URL: 'http://unused', QDRANT_COLLECTION: 'test', OLLAMA_URL: 'http://unused', OLLAMA_MODEL: 'test', OLLAMA_TIMEOUT_MS: '1000' })
const { createMachineMonitoringRouter, createMonitoringCredentialRouter } = await import('../src/routes/monitoring.js')
const { requireAuth } = await import('../src/middleware/auth.js')
const { createMonitoringAlertsRouter } = await import('../src/routes/monitoring-alerts.js')

test('alerts enforce live permissions before and after probes and reject caller targets',async()=>{
  let role='super_admin',after=false,calls=0
  const execute=async sql=>sql.includes('FROM dashboard_users')?[{role,is_active:true,session_version:0}]:[]
  const app=express();app.use(createMonitoringAlertsRouter({execute,workers:async()=>{calls++;if(after)role='analyst';return {workers:[]}},scrape:async()=>({state:'OK'})}))
  await serve(app,async base=>{
    const token=jwt.sign({sub:'admin',role,session_version:0},process.env.JWT_SECRET)
    const get=(suffix='',key=token)=>fetch(base+'/api/v2/admin/monitoring-alerts'+suffix,{headers:{Authorization:`Bearer ${key}`}})
    assert.equal((await get('','invalid')).status,401)
    assert.equal((await get('?url=http://evil')).status,400);assert.equal(calls,0)
    const good=await get();assert.equal(good.status,200);assert.equal(good.headers.get('cache-control'),'no-store')
    role='analyst';assert.equal((await get()).status,403)
    role='super_admin';after=true;assert.equal((await get()).status,403)
  })
})

async function serve(app, work) {
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  try { await work(`http://127.0.0.1:${server.address().port}`) }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
}
test('opaque random keys, hashed storage and constrained explicit expiry', async () => {
  const key = newMonitoringToken()
  assert.notEqual(key.token, newMonitoringToken().token)
  assert.equal(key.hash.length, 64)
  assert.equal(await verifyMonitoringToken(`Bearer ${key.token}`, async (sql, args) => {
    assert.deepEqual(args, [key.id])
    assert.match(sql, /revoked_at IS NULL/)
    assert.match(sql, /expires_at > clock_timestamp\(\)/)
    assert.match(sql, /u.is_active=true AND u.role='super_admin'/)
    return [{ secret_hash: key.hash }]
  }), true)
  assert.equal(await verifyMonitoringToken(`Bearer ${key.token}`, async () => []), false)
  assert.equal(await verifyMonitoringToken(`Bearer ${key.token}`, async () => [{secret_hash:'0'.repeat(64)}]), false)
  for (const value of [undefined, 'Bearer admin-jwt', 'Basic anything']) {
    assert.equal(await verifyMonitoringToken(value, async () => { throw Error('must not query') }), false)
  }
  assert.deepEqual(parseMonitoringIssue({label:'prometheus-demo',ttl_seconds:60}, 60), {label:'prometheus-demo',ttl_seconds:60})
  for (const body of [{label:'ok',ttl_seconds:61},{label:'ok',ttl_seconds:0},{label:'ok',ttl_seconds:'60'},
    {label:'ok',ttl_seconds:60,scope:'admin'}, {label:'\n',ttl_seconds:60}]) assert.throws(() => parseMonitoringIssue(body,60))
})
test('machine endpoint is GET-only, no JWT fallback, rechecks and fails closed', async () => {
  const key = newMonitoringToken(); let active=true, fail=false, revokeDuringProbe=false, probes=0
  const app=express()
  app.use(createMachineMonitoringRouter({execute:async()=>{if(fail)throw Error('private database URL');return active?[{secret_hash:key.hash}]:[]},
    lag:async()=>{probes++;if(revokeDuringProbe)active=false;return {groups:[]}},workers:async()=>({workers:[]})}))
  app.use('/api/v2/admin/test',requireAuth,(_req,res)=>res.json({ok:true}))
  await serve(app,async base=>{
    const get=(path='/api/monitoring/metrics',token=key.token,method='GET')=>fetch(base+path,{method,headers:{Authorization:`Bearer ${token}`}})
    assert.equal((await get(undefined,'not-a-key')).status,401);assert.equal(probes,0)
    assert.equal((await get('/api/v2/admin/test')).status,401)
    assert.equal((await get('/api/monitoring/metrics?target=evil')).status,400)
    assert.equal((await get(undefined,undefined,'POST')).status,405)
    const good=await get();assert.equal(good.status,200);assert.equal(good.headers.get('cache-control'),'no-store')
    assert.match(await good.text(),/funnelmetry_monitoring_snapshot_available/)
    revokeDuringProbe=true;assert.equal((await get()).status,401)
    fail=true;const unavailable=await get();assert.equal(unavailable.status,503);assert.doesNotMatch(await unavailable.text(),/private/)
  })
})
test('only live Admin issues keys, persists hash and audit, never lists token',async()=>{
  let role='super_admin';const writes=[]
  const app=express();app.use(express.json());app.use(createMonitoringCredentialRouter({
    execute:async sql=>sql.includes('FROM dashboard_users')?[{role,is_active:true,session_version:0}]:[],
    transact:async work=>work(async(sql,args)=>{writes.push([sql,args]);
      if(sql.includes('FROM dashboard_users'))return [{id:'admin'}]
      if(sql.includes('INSERT INTO monitoring_credentials('))return [{id:args[0],label:args[1]}]
      return []}),maxSeconds:3600}))
  await serve(app,async base=>{
    const path=base+'/api/v2/admin/monitoring-credentials'
    const token=jwt.sign({sub:'admin',role,session_version:0},process.env.JWT_SECRET)
    const headers={Authorization:`Bearer ${token}`,'Content-Type':'application/json'}
    assert.equal((await fetch(path,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401)
    role='analyst';assert.equal((await fetch(path,{method:'POST',headers,body:'{}'})).status,403)
    role='super_admin';const response=await fetch(path,{method:'POST',headers,body:JSON.stringify({label:'test',ttl_seconds:60})})
    assert.equal(response.status,201);const result=await response.json();assert.match(result.token,/^fmmon_/)
    assert.equal(result.capability,'metrics.read');assert.doesNotMatch(JSON.stringify(writes),new RegExp(result.token.replaceAll('.','\\.')))
    assert.ok(writes.some(([sql])=>sql.includes("'issued'")))
    assert.equal((await fetch(path,{headers})).status,200)
  })
})
