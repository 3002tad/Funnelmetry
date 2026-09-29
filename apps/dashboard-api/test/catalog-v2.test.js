import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
Object.assign(process.env, { PORT:'32000', CORS_ORIGIN_DASHBOARD:'http://localhost:5180', JWT_SECRET:'catalog-test-only', JWT_EXPIRES:'1h', DASHBOARD_ADMIN_EMAIL:'test@example.invalid', DASHBOARD_ADMIN_PASSWORD:'test-only', POSTGRES_HOST:'unused', POSTGRES_PORT:'5432', POSTGRES_DB:'unused', POSTGRES_USER:'unused', POSTGRES_PASSWORD:'unused', DASHBOARD_ENABLE_AI:'false', DASHBOARD_ENABLE_LEGACY:'false' })
const { createCatalogV2Router } = await import('../src/routes/catalog-v2.js')
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
