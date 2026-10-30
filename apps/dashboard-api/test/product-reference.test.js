import test from 'node:test'
import assert from 'node:assert/strict'
import {attachProductReferences,attachEventProductReferences} from '../src/lib/product-reference.js'
test('CDC catalog is source scoped and never changes counts or row grain',async()=>{
  const rows=[{product_id:'p1',views:'9007199254740993'},{product_id:'p2',views:'0'}]
  let calls=0
  const tx=async(sql,params)=>{
    if(calls++===0)return [{installed:true}]
    if(calls===2)return [{coverage_epoch_id:'epoch-2',readable:true}]
    assert.match(sql,/source_id=\$1 AND product_id=ANY\(\$2::text\[\]\)/)
    assert.deepEqual(params,['source-a',['p1','p2']])
    return [{product_id:'p1',title:'Áo xanh',snapshot_id:'snapshot',observed_at:'2026-09-29'}]
  }
  const result=await attachProductReferences(tx,'source-a',rows)
  assert.equal(result.length,2);assert.equal(result[0].views,rows[0].views)
  assert.equal(result[0].reference.title,'Áo xanh');assert.equal(result[1].reference,null)
  assert.equal(rows[0].reference,undefined)
  await assert.rejects(attachProductReferences(async()=>[{installed:false}],'source-a',rows),
    /catalog_cdc_binding_unavailable/)
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
    if(calls===2)return [{coverage_epoch_id:'epoch-2',readable:true}]
    assert.deepEqual(params,['source-a',['p1','missing']])
    return [{product_id:'p1',title:'Current title',snapshot_id:'s',observed_at:'2026-09-29'}]
  }
  const enriched=await attachEventProductReferences(query,'source-a',events)
  assert.equal(calls,3);assert.equal(enriched[0].business_details.total_amount,'20.00')
  assert.equal(enriched[0].business_details.items.length,3)
  assert.equal(enriched[0].business_details.items[0].unit_price_amount,'10.00')
  assert.equal(enriched[0].business_details.items[0].product_reference.title,'Current title')
  assert.equal(enriched[0].business_details.items[2].product_reference,null)
  assert.equal(enriched[1].business_details.product_reference.title,'Current title')
  assert.equal(enriched[2].business_details,null)
  assert.equal(events[0].business_details.items[0].product_reference,undefined)
})

test('CDC catalog read is source scoped and requires an active quality lease',async()=>{
  const rows=[{product_id:'p1',views:'2'},{product_id:'p2',views:'0'}]
  const statements=[]
  const tx=async(sql,params)=>{
    statements.push(sql)
    if(statements.length===1)return [{installed:true}]
    if(statements.length===2){
      assert.match(sql,/catalog_cdc_quality_lease/)
      assert.deepEqual(params,['source-a'])
      return [{coverage_epoch_id:'epoch-2',readable:true}]
    }
    assert.match(sql,/FROM current_product_reference_names_cdc/)
    assert.deepEqual(params,['source-a',['p1','p2']])
    return [{product_id:'p1',title:'Current CDC title',snapshot_id:null,
      provider:'medusa-postgres-cdc-v1',coverage_epoch_id:'epoch-2'}]
  }
  const result=await attachProductReferences(tx,'source-a',rows,{provider:'catalog_cdc'})
  assert.equal(result[0].reference.title,'Current CDC title')
  assert.equal(result[0].reference.snapshot_id,null)
  assert.equal(result[0].reference.coverage_epoch_id,'epoch-2')
  assert.equal(result[1].reference,null)
  assert.equal(result[0].views,rows[0].views)
  assert.equal(statements.length,3)
  assert.ok(statements.every(sql=>!sql.includes('FROM current_product_reference_names WHERE')))
})

test('CDC catalog blocks when schema, binding or quality is missing',async()=>{
  const rows=[{product_id:'p1'}]
  await assert.rejects(attachProductReferences(async()=>[{installed:false}],
    'source-a',rows,{provider:'catalog_cdc'}),/catalog_cdc_binding_unavailable/)
  let calls=0
  await assert.rejects(attachProductReferences(async()=>{
    calls++
    return calls===1?[{installed:true}]:[{coverage_epoch_id:'epoch-2',readable:false}]
  },'source-a',rows,{provider:'catalog_cdc'}),/catalog_cdc_blocked_by_quality/)
  assert.equal(calls,2)
  await assert.rejects(attachProductReferences(async()=>[],
    'source-a',rows,{provider:'unknown'}),/product_reference_provider_invalid/)
})
