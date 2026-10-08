import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
import pg from 'pg'
import { randomUUID } from 'node:crypto'
import { readdir, readFile } from 'node:fs/promises'

Object.assign(process.env, { PORT: '32000', CORS_ORIGIN_DASHBOARD: 'http://localhost:5180',
  JWT_SECRET: 'admin-test-only-secret', JWT_EXPIRES: '1h', DASHBOARD_ADMIN_EMAIL: 'admin@example.test',
  DASHBOARD_ADMIN_PASSWORD: 'test-only-password', PIPELINE_TRACKING_API_URL: 'http://unused',
  POSTGRES_HOST: 'unused', POSTGRES_PORT: '5432', POSTGRES_DB: 'test', POSTGRES_USER: 'test', POSTGRES_PASSWORD: 'test',
  QDRANT_URL: 'http://unused', QDRANT_COLLECTION: 'test', OLLAMA_URL: 'http://unused',
  OLLAMA_MODEL: 'test', OLLAMA_TIMEOUT_MS: '1000' })
const { createAdminV2Router } = await import('../src/routes/admin-v2.js')
const { createUsersRouter } = await import('../src/routes/users.js')
const { requireAuth } = await import('../src/middleware/auth.js')
const { requireLivePermission } = await import('../src/middleware/live-permission.js')
const { requireLiveSession } = await import('../src/middleware/live-session.js')
const { permissionsFor } = await import('../src/lib/roles.js')
const { mutateAccount } = await import('../src/lib/account-mutation.js')
const { assertAccountSchema, AccountSchemaError } = await import('../src/lib/account-schema.js')

test('Kafka lag endpoint accepts no client target and rechecks live grants after probe', async () => {
  let role = 'super_admin', version = 0, calls = 0, afterProbe = () => {}
  const app = express()
  app.use(createAdminV2Router(async () => [{ role, is_active: true, session_version: version }], undefined,
    async () => { calls++; afterProbe(); return { status: 'UNVERIFIED', groups: [] } }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const token = jwt.sign({ sub:'admin', role, session_version:0 }, process.env.JWT_SECRET)
  const get = (suffix='', auth=true, method='GET') => fetch(`http://127.0.0.1:${server.address().port}/api/v2/admin/kafka-lag${suffix}`,
    { method, headers:auth ? { Authorization:`Bearer ${token}` } : {} })
  try {
    assert.equal((await get('',false)).status,401)
    for (const suffix of ['?broker=evil','?source_id=shop','?group_id=other']) assert.equal((await get(suffix)).status,400)
    assert.equal((await get('',true,'POST')).status,404); assert.equal(calls,0)
    const response=await get(); assert.equal(response.status,200); assert.equal(response.headers.get('cache-control'),'no-store')
    role='analyst'; assert.equal((await get()).status,403)
    role='super_admin'; afterProbe=()=>{role='analyst'}; assert.equal((await get()).status,403)
    role='super_admin'; afterProbe=()=>{version++}; assert.equal((await get()).status,401)
    version=0; afterProbe=()=>{throw Error('secret')}
    const failed=await get(); assert.equal(failed.status,503); assert.deepEqual(await failed.json(),{error:'kafka_lag_unavailable'})
  } finally { server.closeAllConnections(); await new Promise(resolve=>server.close(resolve)) }
})

test('processing observation preserves exact counts, unknown lag and live authorization', async () => {
  let role = 'super_admin', version = 0, active = true, fail = false, afterQuery = () => {}, calls = 0
  const app = express()
  app.use(createAdminV2Router(async (sql, params) => {
    if (sql.startsWith('SELECT role')) return [{ role, is_active: active, session_version: version }]
    calls++
    assert.deepEqual(params, ["shop'--"])
    assert.match(sql, /canonicalization_latest_outcomes/)
    assert.match(sql, /COUNT\(\*\)::text/)
    assert.ok(!sql.includes("shop'--"))
    if (fail) throw Error('private connection string')
    afterQuery()
    return [{ stage: 'normalized', retained_count: '9007199254740993', last_processed_at: null, last_recorded_at: null, secret: 'private' }]
  }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const token = jwt.sign({ sub: 'admin', role, session_version: 0 }, process.env.JWT_SECRET)
  const request = (suffix = '?source_id=shop%27--', auth = true, method = 'GET') => fetch(
    `http://127.0.0.1:${server.address().port}/api/v2/admin/processing${suffix}`,
    { method, headers: auth ? { Authorization: `Bearer ${token}` } : {} })
  try {
    assert.equal((await request('', false)).status, 401)
    for (const query of ['', '?source_id=', '?source_id[]=x', '?source_id=x&limit=1', '?source_id=x&source_id=y', `?source_id=${'x'.repeat(201)}`]) {
      assert.equal((await request(query)).status, 400)
    }
    assert.equal((await request('', true, 'POST')).status, 404)
    assert.equal(calls, 0)
    const response = await request()
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const body = await response.json()
    assert.equal(body.stages[0].retained_count, '9007199254740993')
    assert.equal(body.kafka_consumer_lag, null)
    assert.equal(body.kafka_lag_status, 'UNVERIFIED')
    assert.equal(body.scope, 'retained_postgres_records')
    assert.ok(!JSON.stringify(body).includes('private'))
    role = 'analyst'; assert.equal((await request()).status, 403)
    role = 'super_admin'; active = false; assert.equal((await request()).status, 401)
    active = true; afterQuery = () => { role = 'analyst' }; assert.equal((await request()).status, 403)
    role = 'super_admin'; afterQuery = () => { version++ }; assert.equal((await request()).status, 401)
    version = 0; afterQuery = () => {}; fail = true
    const failure = await request(); assert.equal(failure.status, 503)
    assert.deepEqual(await failure.json(), { error: 'processing_observation_unavailable' })
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})

test('event feed monitoring is read-only, session guarded and rechecks grants after probe', async () => {
  let role = 'super_admin', version = 0, active = true, afterProbe = () => {}, calls = 0
  const execute = async () => [{ role, is_active: active, session_version: version }]
  const app = express()
  app.use(createAdminV2Router(execute, async () => {
    calls++; afterProbe()
    return { checked_at: '2026-10-08T00:00:00Z', reachable: true, ready: false,
      status: 'BLOCKED', last_success_at: null,
      feed_observation: { connector_id: 'connector-test', event_feed_id: 'feed-test',
        observed_at: '2026-10-08T00:00:00Z', requested_after_seq: '0', retention_floor_seq: '0',
        latest_available_seq: '3', returned_count: 2 }, error: 'private' }
  }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const token = jwt.sign({ sub: 'admin', role, session_version: 0 }, process.env.JWT_SECRET)
  const request = (suffix = '', method = 'GET', auth = true) => fetch(
    `http://127.0.0.1:${server.address().port}/api/v2/admin/event-feed${suffix}`,
    { method, headers: auth ? { Authorization: `Bearer ${token}` } : {} })
  try {
    assert.equal((await request('', 'GET', false)).status, 401)
    assert.equal((await request('?url=http://attacker')).status, 400)
    assert.equal((await request('', 'POST')).status, 404)
    assert.equal(calls, 0)
    const response = await request()
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const body = await response.json()
    assert.equal(body.observation.latest_available_seq, '3')
    assert.equal(body.status, 'BLOCKED') // old snapshot must not imply current availability
    assert.equal(body.processing_checkpoint_available, false)
    assert.ok(!JSON.stringify(body).includes('private'))
    role = 'analyst'; assert.equal((await request()).status, 403)
    role = 'super_admin'; active = false; assert.equal((await request()).status, 401)
    active = true; afterProbe = () => { role = 'analyst' }
    assert.equal((await request()).status, 403)
    role = 'super_admin'; afterProbe = () => { version++ }
    assert.equal((await request()).status, 401)
    version = 0; afterProbe = () => { throw Error('private') }
    const failure = await request(); assert.equal(failure.status, 503)
    assert.deepEqual(await failure.json(), { error: 'event_feed_observation_unavailable' })
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})
test('quarantine endpoint validates scope and hides raw payload',async()=>{
  let role='super_admin',fail=false
  const app=express();app.use(createAdminV2Router(async(sql,params)=>{
    if(sql.startsWith('SELECT role'))return [{role,is_active:true}]
    if(fail)throw Error('private detail')
    assert.deepEqual(params,['medusa-reference','quarantined',0]);assert.match(sql,/canonicalization_latest_outcomes/);assert.ok(!sql.includes('outcome_document'));assert.ok(!sql.includes('raw_record_id'))
    return Array.from({length:26},(_,i)=>({source_event_id:String(i),status:'quarantined',reason_code:'TEST'}))
  }))
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r))
  const token=jwt.sign({sub:'admin',role:'super_admin'},process.env.JWT_SECRET)
  const get=(q='source_id=medusa-reference&status=quarantined',auth=true)=>fetch(`http://127.0.0.1:${server.address().port}/api/v2/admin/quarantine?${q}`,{headers:auth?{Authorization:`Bearer ${token}`}:{}})
  try{
    assert.equal((await get('',false)).status,401)
    for(const q of ['','source_id=x&offset=-1','source_id=x&offset=10001','source_id=x&status=normalized','source_id[]=x'])assert.equal((await get(q)).status,400)
    const body=await(await get()).json();assert.equal(body.items.length,25);assert.equal(body.next_offset,25);assert.equal(body.replay_available,false)
    role='analyst';assert.equal((await get()).status,403)
    role='super_admin';fail=true;assert.deepEqual(await(await get()).json(),{error:'quarantine_unavailable'})
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
})
test('connector cursor API enforces permission, bounds and exact string sequences',async()=>{
  let role='super_admin',fail=false
  const app=express();app.use(createAdminV2Router(async(sql,params)=>{
    if(sql.startsWith('SELECT role'))return [{role,is_active:true}]
    if(fail)throw Error('secret')
    assert.match(sql,/after_seq::text/);assert.deepEqual(params,['connector-test',null])
    return Array.from({length:26},(_,i)=>({connector_id:`c${i}`,event_feed_id:'feed',after_seq:'9007199254740991',updated_at:'2026-09-29T00:00:00Z'}))
  }))
  const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r))
  const token=jwt.sign({sub:'admin',role:'super_admin'},process.env.JWT_SECRET)
  const get=(suffix='?connector_id=connector-test',auth=true)=>fetch(`http://127.0.0.1:${server.address().port}/api/v2/admin/connectors${suffix}`,{headers:auth?{Authorization:`Bearer ${token}`}:{}})
  try{
    assert.equal((await get('',false)).status,401)
    for(const suffix of ['?after=','?unknown=x','?connector_id[]=x'])assert.equal((await get(suffix)).status,400)
    const response=await get();const body=await response.json();assert.equal(body.items.length,25);assert.equal(body.next_after,'c24');assert.equal(body.items[0].after_seq,'9007199254740991');assert.equal(body.runtime_status,'UNVERIFIED')
    role='analyst';assert.equal((await get()).status,403)
    role='super_admin';fail=true;const error=await get();assert.equal(error.status,503);assert.deepEqual(await error.json(),{error:'connector_state_unavailable'})
  }finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
})

test('admin capability routes reject stale grants, inactive users, outages and invalid scope', async () => {
  let role = 'super_admin', active = true, outage = false
  const calls = []
  const execute = async (sql, params) => {
    if (outage) throw new Error('private DB detail')
    if (sql.startsWith('SELECT role')) return [{ role, is_active: active }]
    calls.push({ sql, params })
    return [{ accepted: 3, terminal: 2, canonical: 2, kpi_applications: 2, pending_claims: 1 }]
  }
  const app = express()
  app.use(express.json(), createAdminV2Router(execute))
  app.use(requireAuth, requireLivePermission('user.manage', execute), createUsersRouter(execute))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  const token = jwt.sign({ sub: 'self', role: 'super_admin' }, process.env.JWT_SECRET)
  const request = (path, init = {}) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
  })
  try {
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/v2/admin/roles`)).status, 401)
    assert.equal((await fetch(`http://127.0.0.1:${server.address().port}/api/v2/admin/sources`)).status, 401)
    assert.equal((await request('/api/v2/admin/sources?limit=101')).status, 400)
    assert.equal((await request('/api/v2/admin/pipeline')).status, 400)
    const response = await request('/api/v2/admin/pipeline?source_id=shop')
    assert.equal(response.status, 200)
    assert.equal((await response.json()).runtime_status, 'UNVERIFIED')
    assert.deepEqual(calls[0].params, ['shop'])
    assert.equal(calls[0].sql.includes('tracking_events_clean'), false)
    assert.equal(permissionsFor('super_admin').includes('analytics.read'), false)
    const rolesResponse = await request('/api/v2/admin/roles')
    assert.equal(rolesResponse.status, 200)
    assert.deepEqual((await rolesResponse.json()).roles.map(item => item.role), ['super_admin', 'analyst', 'staff'])
    const count = calls.length
    assert.equal((await request('/api/v2/admin/audit?limit=101')).status, 400)
    assert.equal((await request('/api/users/self', { method: 'PATCH', body: JSON.stringify({ role: 'analyst' }) })).status, 400)
    assert.equal((await request('/api/users', { method: 'POST', body: JSON.stringify({ email: 'x@y.test', password: 'short' }) })).status, 400)
    assert.equal(calls.length, count)
    role = 'staff'
    assert.equal((await request('/api/v2/admin/sources')).status, 403)
    assert.equal((await request('/api/v2/admin/audit')).status, 403)
    assert.equal((await request('/api/v2/admin/roles')).status, 403)
    assert.equal((await request('/api/users')).status, 403)
    role = 'analyst'
    assert.equal((await request('/api/v2/admin/sources')).status, 403)
    assert.equal((await request('/api/v2/admin/audit')).status, 403)
    assert.equal((await request('/api/v2/admin/roles')).status, 403)
    assert.equal((await request('/api/users')).status, 403)
    active = false
    assert.equal((await request('/api/v2/admin/sources')).status, 401)
    assert.equal((await request('/api/v2/admin/roles')).status, 401)
    outage = true
    assert.equal((await request('/api/v2/admin/sources')).status, 503)
    assert.equal((await request('/api/v2/admin/audit')).status, 503)
    const failure = await request('/api/v2/admin/roles')
    assert.equal(failure.status, 503)
    assert.equal((await failure.text()).includes('private DB'), false)
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})

test('admin users and pipeline evidence work with PostgreSQL V2', { skip: !process.env.TEST_DATABASE_URL }, async () => {
  const schema = `admin_${randomUUID().replaceAll('-', '')}`
  const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` })
  let server
  try {
    await db.query(`CREATE SCHEMA ${schema}`)
    const dir = new URL('../../../infra/postgres/v2/', import.meta.url)
    for (const file of (await readdir(dir)).filter(file => file.endsWith('.sql')).sort()) {
      await pool.query(await readFile(new URL(file, dir), 'utf8'))
    }
    await pool.query(`CREATE TABLE dashboard_users (id UUID PRIMARY KEY, email TEXT UNIQUE, password_hash TEXT,
      display_name TEXT, role TEXT, is_active BOOLEAN DEFAULT TRUE, last_login_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW(), updated_at TIMESTAMP DEFAULT NOW())`)
    for (const file of ['006_dashboard_staff.sql', '007_dashboard_sessions.sql', '008_dashboard_account_audit.sql', '009_dashboard_audit_pagination.sql']) {
      await pool.query(await readFile(new URL(`../../../infra/postgres/${file}`, import.meta.url), 'utf8'))
    }
    const adminId = randomUUID()
    await pool.query("INSERT INTO dashboard_users(id,email,role) VALUES ($1,'admin@test.local','super_admin')", [adminId])
    const execute = async (sql, params) => (await pool.query(sql, params)).rows
    await assertAccountSchema(execute)
    await execute('ALTER TABLE dashboard_users DISABLE TRIGGER dashboard_revoke_sessions')
    await assert.rejects(assertAccountSchema(execute), AccountSchemaError)
    await execute('ALTER TABLE dashboard_users ENABLE TRIGGER dashboard_revoke_sessions')
    await assertAccountSchema(execute)
    const run = async work => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await work(async (sql, params) => (await client.query(sql, params)).rows)
        await client.query('COMMIT')
        return result
      } catch (error) { await client.query('ROLLBACK'); throw error }
      finally { client.release() }
    }
    const app = express()
    app.use(express.json(), requireAuth, requireLiveSession(execute), createAdminV2Router(execute))
    app.use(requireAuth, requireLivePermission('user.manage', execute), createUsersRouter(execute, run))
    server = app.listen(0, '127.0.0.1')
    await new Promise(resolve => server.once('listening', resolve))
    const bearer = jwt.sign({ sub: adminId, role: 'super_admin', session_version: 0 }, process.env.JWT_SECRET)
    const request = (path, method = 'GET', body) => fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method, headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    })
    const emptySources = await request('/api/v2/admin/sources')
    assert.equal(emptySources.status, 200)
    assert.deepEqual((await emptySources.json()).items, [])
    await execute(`INSERT INTO ingress_accepted_receipts(source_id,event_id,ingestion_id,received_at,receipt_document)
      VALUES ('a-shop','event-a','ingest-a',NOW(),'{"status":"accepted","private":"must-not-leak"}')`)
    await execute(`INSERT INTO ingress_receipt_claims(source_id,event_id,ingestion_id,receipt_document,claim_state,owner_token,lease_expires_at)
      VALUES ('b-shop','event-b','ingest-b','{"source_id":"b-shop","event_id":"event-b","ingestion_id":"ingest-b","status":"accepted"}',
        'CLAIMED','private-owner',NOW())`)
    await execute(`INSERT INTO canonicalization_outcomes(source_id,source_event_id,mapping_version,status,reason_code,processed_at,raw_record_id,outcome_document)
      VALUES ('c-shop','event-c','v1','quarantined','test',NOW(),'private-record','{}')`)
    const firstSourcesResponse = await request('/api/v2/admin/sources?limit=1')
    assert.equal(firstSourcesResponse.headers.get('cache-control'), 'no-store')
    const firstSources = await firstSourcesResponse.json()
    assert.equal(firstSources.items[0].source_id, 'a-shop')
    assert.equal(firstSources.items[0].accepted_receipts, '1')
    assert.equal(firstSources.items[0].connection_status, 'UNVERIFIED')
    assert.equal(firstSources.next_after, 'a-shop')
    const restSources = await (await request(`/api/v2/admin/sources?after=${firstSources.next_after}`)).json()
    assert.deepEqual(restSources.items.map(item => item.source_id), ['b-shop','c-shop'])
    assert.equal(restSources.items[0].accepted_receipts, '0')
    assert.equal(restSources.items[0].pending_claims, '1')
    assert.equal(restSources.items[1].quarantined_outcomes, '1')
    assert.equal(restSources.next_after, null)
    assert.equal(JSON.stringify([firstSources,restSources]).includes('private'), false)
    const filteredSources = await (await request('/api/v2/admin/sources?source_id=c-shop')).json()
    assert.equal(filteredSources.items.length, 1)
    assert.equal((await (await request('/api/v2/admin/sources?source_id=missing')).json()).items.length, 0)
    await execute('ALTER TABLE ingress_accepted_receipts RENAME TO receipts_missing')
    const missingSources = await request('/api/v2/admin/sources')
    assert.equal(missingSources.status, 503)
    assert.deepEqual(await missingSources.json(), { error: 'sources_evidence_unavailable' })
    await execute('ALTER TABLE receipts_missing RENAME TO ingress_accepted_receipts')
    const created = await request('/api/users', 'POST', { email: 'analyst@test.local', password: 'local-test-password', role: 'analyst' })
    assert.equal(created.status, 201)
    const { user } = await created.json()
    assert.equal(user.password_hash, undefined)
    assert.equal((await request(`/api/users/${user.id}`, 'PATCH', { is_active: false })).status, 200)
    assert.equal((await execute('SELECT is_active FROM dashboard_users WHERE id=$1', [user.id]))[0].is_active, false)
    assert.equal((await request(`/api/users/${user.id}`, 'PATCH', { is_active: true, role: 'super_admin' })).status, 200)
    assert.equal((await execute('SELECT session_version FROM dashboard_users WHERE id=$1', [user.id]))[0].session_version, 2)
    const audit = await execute('SELECT * FROM dashboard_account_audit ORDER BY created_at')
    assert.equal(audit.length, 3)
    assert.equal(JSON.stringify(audit).includes('local-test-password'), false)
    // Same microsecond timestamps exercise UUID tie-breaking and lossless cursors.
    await execute("UPDATE dashboard_account_audit SET created_at='2026-09-09T00:00:00.123456Z', changes=changes || '{\"password_hash\":\"must-not-leak\"}'::jsonb")
    let cursor = null
    const seen = []
    do {
      const pageResponse = await request(`/api/v2/admin/audit?limit=1${cursor ? `&cursor=${cursor}` : ''}`)
      assert.equal(pageResponse.status, 200)
      assert.equal(pageResponse.headers.get('cache-control'), 'no-store')
      const page = await pageResponse.json()
      assert.equal(JSON.stringify(page).includes('must-not-leak'), false)
      seen.push(...page.items.map(item => item.id))
      cursor = page.next_cursor
      assert.ok(seen.length <= 3)
    } while (cursor)
    assert.equal(new Set(seen).size, 3)
    const filtered = await request(`/api/v2/admin/audit?actor_id=${adminId}&target_id=${user.id}&action=account.created`)
    assert.equal((await filtered.json()).items.length, 1)
    const health = await request('/api/v2/admin/pipeline?source_id=empty-test-source')
    assert.equal(health.status, 200)
    const report = await health.json()
    assert.equal(report.metrics.canonical, 0)
    assert.equal(report.metrics.last_kpi_at, null)
    assert.equal(report.runtime_status, 'UNVERIFIED')
    await assert.rejects(mutateAccount({ id: adminId, session_version: 0 }, adminId, 'test', async sql => {
      await sql("UPDATE dashboard_users SET is_active=false WHERE role='super_admin'")
      return { user: {}, changes: {} }
    }, run), /last_active_admin_required/)
    assert.equal((await execute("SELECT COUNT(*)::int AS n FROM dashboard_users WHERE role='super_admin' AND is_active"))[0].n, 2)

    // Audit failure must roll back both the account change and session increment.
    await pool.query('ALTER TABLE dashboard_account_audit RENAME TO audit_temporarily_unavailable')
    assert.equal((await request(`/api/users/${user.id}`, 'PATCH', { is_active: false })).status, 500)
    assert.equal((await execute('SELECT is_active FROM dashboard_users WHERE id=$1', [user.id]))[0].is_active, true)
    await pool.query('ALTER TABLE audit_temporarily_unavailable RENAME TO dashboard_account_audit')

    const staleToken = jwt.sign({ sub: user.id, role: 'super_admin', session_version: 2 }, process.env.JWT_SECRET)
    assert.equal((await request(`/api/users/${user.id}`, 'PATCH', { password: 'new-local-test-password' })).status, 200)
    const revoked = await fetch(`http://127.0.0.1:${server.address().port}/api/v2/admin/roles`, {
      headers: { Authorization: `Bearer ${staleToken}` },
    })
    assert.equal(revoked.status, 401)
    const secondToken = jwt.sign({ sub: user.id, role: 'super_admin', session_version: 3 }, process.env.JWT_SECRET)
    const competing = await Promise.all([
      request(`/api/users/${user.id}`, 'DELETE'),
      fetch(`http://127.0.0.1:${server.address().port}/api/users/${adminId}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${secondToken}` },
      }),
    ])
    assert.equal(competing.filter(response => response.status === 200).length, 1)
    assert.equal((await execute("SELECT COUNT(*)::int AS n FROM dashboard_users WHERE role='super_admin' AND is_active"))[0].n, 1)
    await execute("UPDATE dashboard_users SET role='analyst' WHERE id=$1", [adminId])
    assert.ok([401, 403].includes((await request('/api/users')).status))
  } finally {
    if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
    await pool.end(); await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await db.end()
  }
})
