import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
const require = createRequire('/workspace/apps/dashboard-api/package.json')
const { Pool } = require('pg'), bcrypt = require('bcryptjs')
const pool = new Pool({ host: process.env.POSTGRES_HOST, port: 5432,
  database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER, password: process.env.POSTGRES_PASSWORD })
try {
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, 'analytics_image_test')
  if (process.argv[2] === 'setup') {
    for (const file of ['003_dashboard_users.sql','006_dashboard_staff.sql','007_dashboard_sessions.sql',
      '008_dashboard_account_audit.sql','009_dashboard_audit_pagination.sql','v2/001_canonical_ledger.sql']) {
      await pool.query(await readFile(`/workspace/test-sql/${file}`, 'utf8'))
    }
    for (const file of ['fact-order-v1.sql','catalog-v1.sql','evidence-v1.sql']) await pool.query(await readFile(`/workspace/analytics/sql/${file}`, 'utf8'))
    const { installStagingOrderCatalog } = await import('/workspace/analytics/src/semantic-registry.mjs')
    await installStagingOrderCatalog(pool)
    await pool.query(`INSERT INTO canonical_events(canonical_event_id,source_id,source_event_id,event_type,event_class,
      canonical_schema_version,mapping_version,occurred_at,ingested_at,normalized_at,aggregate_type,aggregate_id,
      data,quality,raw_record_id,raw_content_hash,raw_byte_size,canonical_document)
      VALUES ('image-order','medusa-reference','image-order','order.placed','BUSINESS_FACT',
      'canonical-event.v1','medusa-order-placed-v2','2026-09-22T12:00:00Z',now(),now(),'order','order_image',
      '{"order_id":"order_image","total_amount":"20.10","currency_code":"eur","amount_unit":"major","amount_semantics":"medusa.order.total"}',
      '{"authoritative_event_time":true,"time_basis":"source_occurred"}','synthetic',repeat('a',64),0,'{}')`)
    console.log('PASS: isolated schema/catalog/one synthetic analytical fixture prepared')
  } else {
    const base = 'http://127.0.0.1:32000'
    const post = (path, body, token) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) })
    const scope = { source_id: 'medusa-reference', from: '2026-09-22', to: '2026-09-23' }
    assert.equal((await fetch(base + '/health')).status, 200)
    const adminLogin = await post('/api/auth/login', { email: process.env.DASHBOARD_ADMIN_EMAIL, password: process.env.DASHBOARD_ADMIN_PASSWORD })
    assert.equal(adminLogin.status, 200)
    const admin = await adminLogin.json()
    assert.equal((await post('/api/v2/chat/order-summary', scope, admin.token)).status, 403)
    const password = 'isolated-analyst-test-password'
    const { rows: [analyst] } = await pool.query(`INSERT INTO dashboard_users(email,password_hash,role)
      VALUES ('analyst@image.test',$1,'analyst') RETURNING id`, [await bcrypt.hash(password, 10)])
    const login = await post('/api/auth/login', { email: 'analyst@image.test', password })
    assert.equal(login.status, 200)
    const { token } = await login.json()
    const result = await post('/api/v2/chat/order-summary', scope, token)
    assert.equal(result.status, 200)
    const body = await result.json(), evidence = body.evidence[0]
    assert.equal(evidence.status, 'PROVISIONAL')
    assert.equal(evidence.result.groups[0].values['measure.gross_order_value@1.0.0'], '20.10')
    assert.deepEqual((await pool.query('SELECT document FROM analytical_execution_evidence WHERE evidence_id=$1 AND actor_id=$2', [evidence.evidence_id, analyst.id])).rows[0].document, evidence)
    assert.equal((await post('/api/auth/logout-all', {}, token)).status, 200)
    assert.equal((await post('/api/v2/chat/order-summary', scope, token)).status, 401)
    console.log('PASS: packaged API startup, health, password login, Admin denial, analyst summary, persisted evidence and logout revocation')
  }
} finally { await pool.end() }
