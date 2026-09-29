import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
Object.assign(process.env,{PORT:'32000',CORS_ORIGIN_DASHBOARD:'http://localhost:5180',JWT_SECRET:'evidence-test-only',JWT_EXPIRES:'1h',DASHBOARD_ADMIN_EMAIL:'test@example.invalid',DASHBOARD_ADMIN_PASSWORD:'test',POSTGRES_HOST:'unused',POSTGRES_PORT:'5432',POSTGRES_DB:'unused',POSTGRES_USER:'unused',POSTGRES_PASSWORD:'unused',DASHBOARD_ENABLE_AI:'false',DASHBOARD_ENABLE_LEGACY:'false'})
const {createEvidenceV2Router} = await import('../src/routes/evidence-v2.js')
test('evidence routes enforce owner, live session, input bounds and sanitized errors',async()=>{
  let role='analyst',version=1,fail=false
  const id='11111111-1111-4111-8111-111111111111'
  const app=express()
  app.use(createEvidenceV2Router(async(sql,params)=>{
    if(sql.startsWith('SELECT role'))return [{role,is_active:true,session_version:version}]
    if(fail)throw Error('secret DB detail')
    if(sql.includes('WHERE evidence_id=$1')) {assert.deepEqual(params,[id,'owner']);return []}
    assert.match(sql,/actor_id=\$1/);assert.equal(params[0],'owner')
    return Array.from({length:26},()=>({evidence_id:id,status:'PROVISIONAL'}))
  }))
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r))
  const token=jwt.sign({sub:'owner',role:'analyst',session_version:1},process.env.JWT_SECRET)
  const get=(path='',auth=true)=>fetch(`http://127.0.0.1:${server.address().port}/api/v2/evidence${path}`,{headers:auth?{Authorization:`Bearer ${token}`}:{}})
  try{
    assert.equal((await get('',false)).status,401)
    for(const path of ['?status=bad','?actor_id=other','?before=bad','/bad','?saved_from=2026-02-30','?saved_to=no','?saved_from=2026-09-28&saved_to=2026-09-27','?source_id=','?saved_from[]=2026-09-28']) assert.equal((await get(path)).status,400)
    const response=await get();const body=await response.json();assert.equal(body.items.length,25);assert.equal(body.next_before,id)
    assert.equal((await get('/'+id)).status,404)
    role='super_admin';assert.equal((await get()).status,403)
    role='analyst';version=2;assert.equal((await get()).status,401)
    version=1;fail=true;const error=await get();assert.equal(error.status,503);assert.deepEqual(await error.json(),{error:'evidence_unavailable'})
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
})
