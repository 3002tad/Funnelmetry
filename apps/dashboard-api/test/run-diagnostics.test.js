import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
Object.assign(process.env,{PORT:'32000',CORS_ORIGIN_DASHBOARD:'http://localhost:5180',JWT_SECRET:'diagnostics-test',JWT_EXPIRES:'1h',DASHBOARD_ADMIN_EMAIL:'test@example.invalid',DASHBOARD_ADMIN_PASSWORD:'test',POSTGRES_HOST:'unused',POSTGRES_PORT:'5432',POSTGRES_DB:'unused',POSTGRES_USER:'unused',POSTGRES_PASSWORD:'unused',DASHBOARD_ENABLE_AI:'false',DASHBOARD_ENABLE_LEGACY:'false'})
const {createRunDiagnosticsRouter}=await import('../src/routes/run-diagnostics.js')
test('diagnostics enforces live authorization, bounded query and redacted results',async()=>{
  let role='analyst',version=1,fail=false,revoke=false,reads=0
  const app=express();app.use(createRunDiagnosticsRouter({execute:async()=>[{role,is_active:true,session_version:version}],
    readOnly:async work=>work(async(sql,args)=>{
      reads++;assert.match(sql,/LIMIT 50/);assert.match(sql,/interval '30 days'/);assert.deepEqual(args,['ERROR'])
      if(fail)throw Error('PRIVATE_DATABASE');if(revoke)version++
      return [{analysis_run_id:'run',tool_call_id:'call',created_at:'now',status:'ERROR',tool_id:'unknown-secret-tool',code:'PRIVATE_ERROR',actor_id:'PRIVATE_ACTOR',document:{secret:'PRIVATE_DOC'}}]
    })}))
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r))
  const token=jwt.sign({sub:'admin',role:'super_admin',session_version:1},process.env.JWT_SECRET)
  const get=(q='?status=ERROR',auth=true)=>fetch(`http://127.0.0.1:${server.address().port}/api/v2/admin/run-diagnostics${q}`,{headers:auth?{Authorization:`Bearer ${token}`}:{}})
  try{
    assert.equal((await get('',false)).status,401);assert.equal((await get()).status,403);assert.equal(reads,0)
    role='super_admin';for(const q of ['?limit=10000','?status=anything','?status=ERROR&status=ERROR'])assert.equal((await get(q)).status,400)
    const response=await get();assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store')
    const body=await response.json();assert.equal(body.items[0].code,'UNCLASSIFIED_ERROR');assert.equal(body.items[0].tool_id,null)
    assert.doesNotMatch(JSON.stringify(body),/PRIVATE|unknown-secret/)
    fail=true;assert.equal((await get()).status,503)
    fail=false;revoke=true;assert.equal((await get()).status,401)
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
})
