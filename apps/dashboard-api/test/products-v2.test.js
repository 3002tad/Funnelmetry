import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
Object.assign(process.env,{PORT:'32000',CORS_ORIGIN_DASHBOARD:'http://localhost:5180',JWT_SECRET:'products-test-only',JWT_EXPIRES:'1h',DASHBOARD_ADMIN_EMAIL:'test@example.invalid',DASHBOARD_ADMIN_PASSWORD:'test',POSTGRES_HOST:'unused',POSTGRES_PORT:'5432',POSTGRES_DB:'unused',POSTGRES_USER:'unused',POSTGRES_PASSWORD:'unused',DASHBOARD_ENABLE_AI:'false',DASHBOARD_ENABLE_LEGACY:'false'})
const {createProductsV2Router}=await import('../src/routes/products-v2.js')
test('product observations validate scope and sort, parameterize filters, enforce permissions',async()=>{
  let role='analyst',version=1,fail=false,calls=0
  const app=express()
  app.use(createProductsV2Router({execute:async()=>[{role,is_active:true,session_version:version}],readOnly:async work=>work(async(sql,params)=>{
    if(sql.includes('to_regclass'))return [{installed:false}]
    calls++;if(fail)throw Error('private detail')
    assert.match(sql,/event_class='BUSINESS_FACT'/)
    assert.match(sql,/ORDER BY views DESC,product_id ASC/)
    assert.equal(params[3],'2026-09-21T00:00:00.000Z')
    assert.equal(params[4],"prod'quoted")
    return [{product_id:params[4],views:'9007199254740993',adds:'1',previous_views:'0',previous_adds:'0'}]
  })}))
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r))
  const token=jwt.sign({sub:'owner',role:'analyst',session_version:1},process.env.JWT_SECRET)
  const base=`http://127.0.0.1:${server.address().port}/api/v2/products?source_id=medusa-reference&from=2026-09-22&to=2026-09-23&product_id=prod%27quoted`
  const get=(suffix='',auth=true)=>fetch(base+suffix,{headers:auth?{Authorization:`Bearer ${token}`}:{}})
  try{
    assert.equal((await get('',false)).status,401)
    for(const suffix of ['&sort=DROP','&offset=-1','&offset=10001','&unknown=true'])assert.equal((await get(suffix)).status,400)
    const response=await get();assert.equal(response.status,200);assert.equal((await response.json()).items[0].views,'9007199254740993')
    role='super_admin';assert.equal((await get()).status,403)
    role='analyst';version=2;assert.equal((await get()).status,401)
    assert.equal(calls,1)
    version=1;fail=true;const error=await get();assert.equal(error.status,503);assert.deepEqual(await error.json(),{error:'product_observations_unavailable'})
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
})
