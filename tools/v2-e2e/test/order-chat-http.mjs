import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { createStagingAnalysisRunner } from '../../../analytics/src/analysis-run.mjs'
import { discoverStagingOrderTool } from '../../../analytics/src/semantic-registry.mjs'

// Called only inside the isolated conformance DB, after analytical fixtures exist.
export async function verifyOrderChatHttp(pool) {
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, 'medusa_contract_test')
  for (const file of ['003_dashboard_users.sql', '007_dashboard_sessions.sql']) {
    await pool.query(await readFile(new URL(`../../../infra/postgres/${file}`, import.meta.url), 'utf8'))
  }
  const { rows: [user] } = await pool.query(`INSERT INTO dashboard_users(email,password_hash,role)
    VALUES ('isolated-analyst@test.invalid','not-a-login-password','analyst') RETURNING id,session_version`)
  // Synthetic configuration only; no real env files or provider credentials loaded.
  Object.assign(process.env, { PORT: '32000', CORS_ORIGIN_DASHBOARD: 'http://localhost:5180',
    JWT_SECRET: 'isolated-http-test-only', JWT_EXPIRES: '1h', DASHBOARD_ADMIN_EMAIL: 'test@test.invalid',
    DASHBOARD_ADMIN_PASSWORD: 'test-only', POSTGRES_HOST: 'unused', POSTGRES_PORT: '5432',
    POSTGRES_DB: 'unused', POSTGRES_USER: 'unused', POSTGRES_PASSWORD: 'unused',
    DASHBOARD_ENABLE_AI: 'false', DASHBOARD_ENABLE_LEGACY: 'false' })
  const require = createRequire(new URL('../../../apps/dashboard-api/package.json', import.meta.url))
  const express = require('express'), jwt = require('jsonwebtoken')
  const { createChatV2Router } = await import('../../../apps/dashboard-api/src/routes/chat-v2.js')
  const { createCatalogV2Router } = await import('../../../apps/dashboard-api/src/routes/catalog-v2.js')
  const { createEvidenceV2Router } = await import('../../../apps/dashboard-api/src/routes/evidence-v2.js')
  const { createProductsV2Router } = await import('../../../apps/dashboard-api/src/routes/products-v2.js')
  const { inspectStagingOrderCatalog } = await import('../../../analytics/src/semantic-registry.mjs')
  const { closeDatabase } = await import('../../../apps/dashboard-api/src/db.js')
  const execute = async (sql, params) => (await pool.query(sql, params)).rows
  const runner = createStagingAnalysisRunner({ pool, authQuery: execute, statementTimeoutMs: 5000 })
  let syntheses = 0, revokeDuringPlan = false
  const provider = { enabled: true, async complete(messages) {
    if (messages[0].content.startsWith('Select')) {
      assert.match(messages[1].content, /order-analytics-staging-1.0.0/)
      if (revokeDuringPlan) await pool.query('UPDATE dashboard_users SET is_active=false WHERE id=$1', [user.id])
      return { text: '{"tool":"tool.metric_summary","last_hours":null}' }
    }
    syntheses++
    const payload = JSON.parse(messages[1].content)
    const { rows: [saved] } = await pool.query('SELECT document FROM analytical_execution_evidence WHERE evidence_id=$1 AND actor_id=$2', [payload.evidence.evidence_id, user.id])
    assert.ok(saved, 'evidence must be committed before synthesis')
    assert.deepEqual(payload.evidence.result, saved.document.result)
    assert.equal(saved.document.result.groups[0].values['measure.gross_order_value@1.0.0'], '20')
    assert.ok(!messages[1].content.includes(user.id))
    return { text: `Giá trị đơn đã đặt: 20 EUR [${payload.evidence.evidence_id}]`, model: 'offline-fixture' }
  } }
  const app = express()
  await pool.query(await readFile(new URL('../../../analytics/sql/evidence-notes-v1.sql', import.meta.url),'utf8'))
  await pool.query(await readFile(new URL('../../../analytics/sql/evidence-notes-v2.sql', import.meta.url),'utf8'))
  app.use(express.json())
  app.use(createCatalogV2Router({ execute, load: () => inspectStagingOrderCatalog(pool) }))
  app.use(createEvidenceV2Router(execute))
  app.use(createProductsV2Router({execute,readOnly: work=>work(execute)}))
  app.use(express.json(), createChatV2Router({ execute, provider, toolsEnabled: false,
    orderSummaryEnabled: true, orderChatEnabled: true, orderRunnerFactory: async () => runner,
    orderToolDiscovery: () => discoverStagingOrderTool(pool) }))
  const server = app.listen(0, '127.0.0.1')
  await new Promise(resolve => server.once('listening', resolve))
  let token = jwt.sign({ sub: user.id, role: 'analyst', session_version: user.session_version }, process.env.JWT_SECRET, { expiresIn: '1h' })
  const request = auth => fetch(`http://127.0.0.1:${server.address().port}/api/v2/chat`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ message: 'Giá trị đơn đã đặt?', source_id: 'medusa-reference', from: '2026-09-22', to: '2026-09-23' }),
  })
  try {
    const products = await fetch(`http://127.0.0.1:${server.address().port}/api/v2/products?source_id=medusa-reference&from=2026-09-22&to=2026-09-23&product_id=prod_test`, {headers:{Authorization:`Bearer ${token}`}})
    assert.equal(products.status,200)
    const observed = await products.json()
    assert.equal(observed.items.length,1)
    assert.equal(observed.items[0].views,'1')
    assert.equal(observed.items[0].adds,'1')
    assert.equal(observed.items[0].previous_views,'0')
    const previousProducts = await fetch(`http://127.0.0.1:${server.address().port}/api/v2/products?source_id=medusa-reference&from=2026-09-23&to=2026-09-24&product_id=prod_test`, {headers:{Authorization:`Bearer ${token}`}})
    const prior = await previousProducts.json()
    assert.equal(prior.items[0].views,'0')
    assert.equal(prior.items[0].previous_views,'1')
    const catalog = await fetch(`http://127.0.0.1:${server.address().port}/api/v2/catalog`, { headers: { Authorization: `Bearer ${token}` } })
    assert.equal(catalog.status, 200)
    const definition = await catalog.json()
    assert.equal(definition.metadata.asset.id, 'asset.fact_order')
    assert.equal(definition.binding_status, 'VERIFIED')
    assert.equal(definition.metadata.runtime_published, false)
    assert.equal((await request(false)).status, 401)
    const response = await request(true)
    assert.equal(response.status, 200)
    const result = await response.json()
    assert.equal(result.status, 'generated')
    assert.equal(result.evidence[0].status, 'PROVISIONAL')
    assert.equal(result.answer_verification, 'DETERMINISTIC_TEMPLATE')
    const { rows: [persisted] } = await pool.query('SELECT document FROM analytical_execution_evidence WHERE evidence_id=$1 AND actor_id=$2', [result.evidence[0].evidence_id, user.id])
    assert.deepEqual(result.evidence[0], persisted.document)
    const list = await fetch(`http://127.0.0.1:${server.address().port}/api/v2/evidence`, {headers:{Authorization:`Bearer ${token}`}})
    const records = await list.json()
    assert.equal(records.items.length,1)
    const filtered=async query=>(await (await fetch(`http://127.0.0.1:${server.address().port}/api/v2/evidence?${query}`,{headers:{Authorization:`Bearer ${token}`}})).json()).items
    assert.equal((await filtered('source_id=missing-source')).length,0)
    assert.equal((await filtered('source_id=medusa-reference')).length,1)
    const savedDay=new Date(records.items[0].created_at).toISOString().slice(0,10)
    assert.equal((await filtered(`saved_from=${savedDay}`)).length,1)
    assert.equal((await filtered(`saved_to=${savedDay}`)).length,0)
    assert.equal(records.items[0].evidence_id,result.evidence[0].evidence_id)
    const detail = await fetch(`http://127.0.0.1:${server.address().port}/api/v2/evidence/${records.items[0].evidence_id}`, {headers:{Authorization:`Bearer ${token}`}})
    assert.deepEqual((await detail.json()).document,persisted.document)
    const notePath=`http://127.0.0.1:${server.address().port}/api/v2/evidence/${records.items[0].evidence_id}/notes`
    const note={note_id:'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',content:'Human hypothesis, not a verified finding <script>example</script>'}
    const saveNote=(body=note)=>fetch(notePath,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)})
    assert.equal((await saveNote()).status,201)
    assert.equal((await saveNote()).status,200)
    assert.equal((await saveNote({...note,review_kind:'INACCURATE'})).status,409)
    assert.equal((await saveNote({...note,review_kind:'OFFICIAL'})).status,400)
    const review={...note,note_id:'dddddddd-dddd-4ddd-8ddd-dddddddddddd',review_kind:'NEEDS_REVIEW'}
    assert.equal((await saveNote(review)).status,201)
    const reviews=await(await fetch(`http://127.0.0.1:${server.address().port}/api/v2/analytical-notes?kind=NEEDS_REVIEW`,{headers:{Authorization:`Bearer ${token}`}})).json()
    assert.equal(reviews.items.length,1);assert.equal(reviews.items[0].review_kind,'NEEDS_REVIEW');assert.equal(reviews.items[0].actor_id,user.id)
    assert.equal((await saveNote({...note,content:'different'})).status,409)
    assert.equal((await saveNote({...note,actor_id:'other'})).status,400)
    assert.equal((await saveNote({...note,content:' '})).status,400)
    const notes=await (await fetch(notePath,{headers:{Authorization:`Bearer ${token}`}})).json()
    assert.equal(notes.items.length,2);assert.equal(notes.items[0].origin,'HUMAN_NOTE');assert.equal(notes.items[0].actor_id,user.id)
    await assert.rejects(pool.query('UPDATE analytical_evidence_notes SET content=$1 WHERE note_id=$2',['rewrite',note.note_id]),/append-only/)
    const otherToken=jwt.sign({sub:'00000000-0000-4000-8000-000000000001',role:'analyst',session_version:0},process.env.JWT_SECRET)
    assert.equal((await fetch(notePath,{headers:{Authorization:`Bearer ${otherToken}`}})).status,401)
    await pool.query("UPDATE dashboard_users SET role='viewer' WHERE id=$1",[user.id])
    assert.equal((await saveNote()).status,401)
    const renewed=async()=>{const {rows:[current]}=await pool.query('SELECT role,session_version FROM dashboard_users WHERE id=$1',[user.id]);return jwt.sign({sub:user.id,...current},process.env.JWT_SECRET,{expiresIn:'1h'})}
    token=await renewed()
    assert.equal((await saveNote()).status,403)
    await pool.query("UPDATE dashboard_users SET role='analyst' WHERE id=$1",[user.id])
    token=await renewed()
    assert.match(result.answer, /giá trị đơn hàng đã đặt 20 EUR/)
    assert.match(result.answer, /medusa-reference/)
    if (process.env.TEST_ORDER_BROWSER === '1') {
      const { runChatBrowser } = await import('../../../apps/dashboard-web/test/chat-browser.mjs')
      await runChatBrowser({ apiOrigin: `http://127.0.0.1:${server.address().port}`, token,
        user: { id: user.id, email: 'isolated-analyst@test.invalid', role: 'analyst', permissions: ['analytics.read', 'chat.use','analytics.notes.write'] },
        async verifyEvidence(evidence) {
          const { rows: [row] } = await pool.query('SELECT document FROM analytical_execution_evidence WHERE evidence_id=$1 AND actor_id=$2', [evidence.evidence_id, user.id])
          assert.ok(row)
          assert.deepEqual(evidence, row.document)
          assert.equal(evidence.result.groups.find(group => group.currency_code === 'EUR').values['measure.gross_order_value@1.0.0'], '20')
        },
      })
    }
    revokeDuringPlan = true
    assert.equal((await request(true)).status, 401)
    assert.equal(syntheses, 0)
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM analytical_execution_evidence WHERE actor_id=$1', [user.id])).rows[0].n, process.env.TEST_ORDER_BROWSER === '1' ? 3 : 1)
    assert.equal((await request(true)).status, 401)
  } finally {
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    await closeDatabase()
  }
}
