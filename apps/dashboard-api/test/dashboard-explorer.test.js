import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import jwt from 'jsonwebtoken'
Object.assign(process.env,{PORT:'32000',CORS_ORIGIN_DASHBOARD:'http://localhost:5180',JWT_SECRET:'explorer-test-only',JWT_EXPIRES:'1h',DASHBOARD_ADMIN_EMAIL:'test@example.invalid',DASHBOARD_ADMIN_PASSWORD:'test',POSTGRES_HOST:'unused',POSTGRES_PORT:'5432',POSTGRES_DB:'unused',POSTGRES_USER:'unused',POSTGRES_PASSWORD:'unused',DASHBOARD_ENABLE_AI:'false',DASHBOARD_ENABLE_LEGACY:'false'})
const {createDashboardExplorerRouter,parseExplorerQuery}=await import('../src/routes/dashboard-explorer.js')
test('exploration limits source, dataset, time window and disallows extra query fields',()=>{
  const base={source_id:'medusa-reference',from:'2026-10-01',to:'2026-11-01'}
  assert.equal(parseExplorerQuery(base).dataset,'observed')
  for(const patch of [{dataset:'pg_catalog'},{source_id:'other-source'},{from:'2025-01-01'},{to:'2026-09-01'},{unknown:'x'},{variant_id:['x'] }])assert.throws(()=>parseExplorerQuery({...base,...patch}))
})
test('exploration enforces live identity, parameterizes dataset/variant and preserves errors and origin',async()=>{
  let role='analyst',version=1,fail=false,calls=0
  const app=express();app.use(createDashboardExplorerRouter({execute:async()=>[{role,is_active:true,session_version:version}],readOnly:async work=>work(async(sql,args)=>{
    calls++;if(fail)throw Error('secret SQL detail')
    assert.ok(!sql.includes("variant'quoted"));assert.equal(args[0],'demo-historical-100000-v2')
    if(sql.startsWith('SELECT (SELECT')){assert.equal(args.length,3);return [{sessions:'2',orders:'1',catalog_products:'4'}]}
    if(sql.includes('GROUP BY 1,2'))return [{date:'2026-10-01',event_type:'behavior.product_viewed',total:'2'}]
    if(sql.includes('AS source,count'))return [{source:'organic',total:'3'}]
    if(sql.includes('count(*)::text AS total'))return [{date:'2026-10-01',total:'3',views:'2',searches:'1'}]
    if(sql.includes("change_type='ADD'"))return [{date:'2026-10-01',cart:'2'},{date:'2026-10-02',cart:'1'}]
    return []
  })}));const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));const token=jwt.sign({sub:'owner',role:'analyst',session_version:1},process.env.JWT_SECRET);const url=`http://127.0.0.1:${server.address().port}/api/v2/analytics/explorer?source_id=medusa-reference&from=2026-10-01&to=2026-11-01&dataset=demo-historical-100000-v2&variant_id=variant%27quoted`;const get=auth=>fetch(url,{headers:auth?{Authorization:`Bearer ${token}`}:{}})
  try{assert.equal((await get(false)).status,401);let response=await get(true);assert.equal(response.status,200);let body=await response.json();assert.equal(body.origin,'SYNTHETIC_BACKFILL');assert.equal(body.quality,'UNVERIFIED');assert.equal(body.contract.official,false);assert.equal(body.counts.sessions,'2');assert.equal(body.counts.orders,'1');assert.equal(body.utm[0].source,'organic');assert.equal(body.event_types[0].event_type,'behavior.product_viewed');assert.equal(body.daily[0].cart,'2');assert.equal(body.daily[1].total,'0');assert.equal(body.daily[1].cart,'1');role='super_admin';const count=calls;assert.equal((await get(true)).status,403);assert.equal(calls,count);role='analyst';version=2;assert.equal((await get(true)).status,401);version=1;fail=true;response=await get(true);assert.equal(response.status,503);assert.ok(!JSON.stringify(await response.json()).includes('secret'))}finally{server.closeAllConnections();await new Promise(r=>server.close(r))}
})
