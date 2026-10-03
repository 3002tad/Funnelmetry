import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
Object.assign(process.env, { PORT:'32000', CORS_ORIGIN_DASHBOARD:'http://localhost:5180', JWT_SECRET:'catalog-test-only', JWT_EXPIRES:'1h', DASHBOARD_ADMIN_EMAIL:'test@example.invalid', DASHBOARD_ADMIN_PASSWORD:'test-only', POSTGRES_HOST:'unused', POSTGRES_PORT:'5432', POSTGRES_DB:'unused', POSTGRES_USER:'unused', POSTGRES_PASSWORD:'unused', DASHBOARD_ENABLE_AI:'false', DASHBOARD_ENABLE_LEGACY:'false' })
const { createCatalogV2Router } = await import('../src/routes/catalog-v2.js')

test('admin mappings rejects non-admin, arbitrary paths and exposes only sanitized failures',async()=>{
  let role='analyst',fail=false
  const app=express();app.use(createCatalogV2Router({execute:async()=>[{role,is_active:true,session_version:1}],loadMappings:async()=>{if(fail)throw Error('SECRET_PATH');return {runtime_status:'UNVERIFIED'}}}))
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r))
  const token=jwt.sign({sub:'mapping-user',role:'super_admin',session_version:1},process.env.JWT_SECRET)
  const get=(suffix='')=>fetch(`http://127.0.0.1:${server.address().port}/api/v2/admin/mappings${suffix}`,{headers:{Authorization:`Bearer ${token}`}})
  try{assert.equal((await get()).status,403);role='super_admin';assert.equal((await get('?path=secret.env')).status,400)
    const ok=await get();assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'no-store')
    fail=true;const bad=await get();assert.equal(bad.status,503);assert.deepEqual(await bad.json(),{error:'mapping_inspection_unavailable'})
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
})

test('admin registry is read-only, live-admin protected and rechecks revocation',async()=>{
  let role='super_admin',version=1,fail=false,revoke=false,loads=0
  const app=express()
  app.use(createCatalogV2Router({execute:async()=>[{role,is_active:true,session_version:version}],loadAdmin:async()=>{
    loads++;if(fail)throw Error('SECRET_INTERNAL');if(revoke)version++
    return {items:[],read_only:true}
  }}))
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r))
  const token=jwt.sign({sub:'admin-test',role:'super_admin',session_version:1},process.env.JWT_SECRET)
  const get=(suffix='',auth=true,method='GET')=>fetch(`http://127.0.0.1:${server.address().port}/api/v2/admin/registry${suffix}`,{method,headers:auth?{Authorization:`Bearer ${token}`}:{}})
  try{
    assert.equal((await get('',false)).status,401)
    role='analyst';assert.equal((await get()).status,403);assert.equal(loads,0)
    role='super_admin';assert.equal((await get('?sql=x')).status,400)
    assert.equal((await get(' ',true,'POST')).status,404)
    const ok=await get();assert.equal(ok.status,200);assert.equal(ok.headers.get('cache-control'),'no-store')
    assert.equal((await ok.json()).read_only,true)
    fail=true;const bad=await get();assert.equal(bad.status,503);assert.deepEqual(await bad.json(),{error:'registry_unavailable'})
    fail=false;revoke=true;assert.equal((await get()).status,401)
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
})
test('catalog inspection requires live permission/session and sanitizes failures', async () => {
  let role = 'analyst', version = 1, active = true, unavailable = false, loads = 0
  const app = express()
  app.use(createCatalogV2Router({ execute: async () => [{ role, session_version: version, is_active: active }], load: async () => {
    loads++
    if (unavailable) throw Error('private database detail')
    return { release_id:'test-release', status:'VALIDATED_STAGING', metadata:{status:'DRAFT'} }
  } }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const token = jwt.sign({sub:'test-actor',role:'analyst',session_version:1}, process.env.JWT_SECRET)
  const get = (suffix = '', auth = true) => fetch(`http://127.0.0.1:${server.address().port}/api/v2/catalog${suffix}`, { headers: auth ? { Authorization:`Bearer ${token}` } : {} })
  try {
    assert.equal((await get('',false)).status,401)
    assert.equal((await get('?sql=select')).status,400)
    const response = await get()
    assert.equal(response.status,200)
    assert.equal(response.headers.get('cache-control'),'no-store')
    assert.equal((await response.json()).metadata.status,'DRAFT')
    role = 'super_admin'; assert.equal((await get()).status,403)
    role = 'analyst'; version = 2; assert.equal((await get()).status,401)
    version = 1; active = false; assert.equal((await get()).status,401)
    assert.equal(loads,1)
    active = true; unavailable = true
    const error = await get(); assert.equal(error.status,503)
    assert.deepEqual(await error.json(),{error:'catalog_unavailable',status:'UNVERIFIED'})
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
