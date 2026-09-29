import test from 'node:test'
import assert from 'node:assert/strict'
import {attachProductReferences,attachEventProductReferences} from '../src/lib/product-reference.js'
test('optional catalog is source scoped and never changes counts or row grain',async()=>{
  const rows=[{product_id:'p1',views:'9007199254740993'},{product_id:'p2',views:'0'}]
  let calls=0
  const tx=async(sql,params)=>{
    if(calls++===0)return [{installed:true}]
    assert.match(sql,/source_id=\$1 AND product_id=ANY\(\$2::text\[\]\)/)
    assert.deepEqual(params,['source-a',['p1','p2']])
    return [{product_id:'p1',title:'Áo xanh',snapshot_id:'snapshot',observed_at:'2026-09-29'}]
  }
  const result=await attachProductReferences(tx,'source-a',rows)
  assert.equal(result.length,2);assert.equal(result[0].views,rows[0].views)
  assert.equal(result[0].reference.title,'Áo xanh');assert.equal(result[1].reference,null)
  assert.equal(rows[0].reference,undefined)
  assert.deepEqual(await attachProductReferences(async()=>[{installed:false}],'source-a',rows),rows.map(row=>({...row,reference:null})))
})
test('event enrichment batches IDs and preserves historical amounts, duplicate lines and missing products',async()=>{
  let calls=0
  const events=[{event_type:'order.placed',business_details:{total_amount:'20.00',items:[
    {product_id:'p1',unit_price_amount:'10.00',quantity:1},
    {product_id:'p1',unit_price_amount:'10.00',quantity:1},
    {product_id:'missing'},
  ]}},{event_type:'behavior.product_viewed',business_details:{product_id:'p1'}},{event_type:'session.started',business_details:null}]
  const query=async(sql,params)=>{
    if(calls++===0)return [{installed:true}]
    assert.deepEqual(params,['source-a',['p1','missing']])
    return [{product_id:'p1',title:'Current title',snapshot_id:'s',observed_at:'2026-09-29'}]
  }
  const enriched=await attachEventProductReferences(query,'source-a',events)
  assert.equal(calls,2);assert.equal(enriched[0].business_details.total_amount,'20.00')
  assert.equal(enriched[0].business_details.items.length,3)
  assert.equal(enriched[0].business_details.items[0].unit_price_amount,'10.00')
  assert.equal(enriched[0].business_details.items[0].product_reference.title,'Current title')
  assert.equal(enriched[0].business_details.items[2].product_reference,null)
  assert.equal(enriched[1].business_details.product_reference.title,'Current title')
  assert.equal(enriched[2].business_details,null)
  assert.equal(events[0].business_details.items[0].product_reference,undefined)
})
