import test from 'node:test'
import assert from 'node:assert/strict'
import {catalogConfig,readCatalog,saveCatalog} from '../src/catalog.js'
const env={CATALOG_SOURCE_ID:'test-source',CATALOG_MEDUSA_URL:'https://example.invalid',CATALOG_MEDUSA_SECRET_KEY:'test-only'}
const config=catalogConfig(env)
const product=i=>({id:`prod_${i}`,title:`Áo ${i}`,updated_at:'2026-09-29T00:00:00Z',price:999,metadata:{private:'not copied'}})
const reply=(products,count=products.length,offset=0)=>new Response(JSON.stringify({products,count,offset,limit:100}))
test('config requires HTTPS origin and separate server credential',()=>{
  for(const url of ['http://example.invalid','https://user:pass@example.invalid','https://example.invalid/path','https://example.invalid?key=secret'])assert.throws(()=>catalogConfig({...env,CATALOG_MEDUSA_URL:url}),/config_invalid/)
  for(const key of ['', 'secret\nvalue'])assert.throws(()=>catalogConfig({...env,CATALOG_MEDUSA_SECRET_KEY:key}))
  assert.throws(()=>catalogConfig({...env,CATALOG_INTERVAL_MS:'0'}))
})
test('bounded paginated read copies only reference fields, no prices or raw metadata',async()=>{
  let calls=0
  const rows=await readCatalog(config,async(url,options)=>{
    assert.equal(options.method,'GET');assert.equal(options.redirect,'error')
    assert.equal(options.headers.Authorization,'Basic test-only')
    assert.equal(url.pathname,'/admin/products');assert.equal(url.searchParams.get('fields'),'id,title,updated_at')
    assert.equal(url.searchParams.get('offset'),String(calls*100))
    return calls++===0?reply(Array.from({length:100},(_,i)=>product(i)),101):reply([product(100)],101,100)
  })
  assert.equal(calls,2);assert.equal(rows.length,101)
  assert.deepEqual(rows[0],{product_id:'prod_0',title:'Áo 0',source_updated_at:'2026-09-29T00:00:00Z'})
})
test('fails closed on duplicates, truncated pages, count drift and malformed fields',async()=>{
  for(const response of [reply([product(1),product(1)]),reply([product(1)],2),reply([{...product(1),title:''}]),reply([{...product(1),updated_at:'bad'}]),reply([],10001)]){
    await assert.rejects(readCatalog(config,async()=>response),/response_invalid/)
  }
  let calls=0
  await assert.rejects(readCatalog(config,async()=>calls++===0?reply(Array.from({length:100},(_,i)=>product(i)),101):reply([product(101),product(102)],102,100)),/response_invalid/)
  assert.deepEqual(await readCatalog(config,async()=>reply([])),[])
})
test('network/auth/oversized failures do not expose source responses or secrets',async()=>{
  for(const fetcher of [async()=>{throw Error('secret')},async()=>new Response('private',{status:401}),async()=>new Response('x'.repeat(1024*1024+1))]){
    await assert.rejects(readCatalog(config,fetcher),{message:'catalog_fetch_failed'})
  }
})
test('snapshot publication is atomic and rolls back failed name insert',async()=>{
  const commands=[]
  const client={query:async(sql,params)=>{commands.push(sql);if(sql.includes('INSERT INTO product_reference_names')){assert.equal(params[0],'test-source');throw Error('db failure')}}}
  await assert.rejects(saveCatalog(client,{sourceId:'test-source',snapshotId:'id',products:[]}),/db failure/)
  assert.equal(commands[0],'BEGIN');assert.equal(commands.at(-1),'ROLLBACK');assert.ok(!commands.includes('COMMIT'))
})
