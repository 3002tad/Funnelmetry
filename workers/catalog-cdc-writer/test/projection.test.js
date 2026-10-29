import test from 'node:test'
import assert from 'node:assert/strict'
import {decodeCatalogChange, persistCatalogChange} from '../src/projection.js'

const prefix='cdc_shadow_medusa_catalog'
const topic=`${prefix}.public.product`
const payload={id:'prod_1',title:'Product',handle:'product',status:'published',
  collection_id:null,updated_at:'2026-10-29T00:00:00Z',deleted_at:null}
const event=(op,after=payload)=>({op,source:{name:prefix,db:'medusa',
  schema:'public',table:'product',lsn:42,snapshot:op==='r'?'last':false},
  before:null,after})

test('exact source scope, snapshot marker and source primary key are required',()=>{
  const row=decodeCatalogChange({topic,partition:0,key:{id:'prod_1'},
    value:event('r')},prefix)
  assert.equal(row.snapshotLast,true)
  assert.equal(row.rowKey,'["prod_1"]')
  assert.throws(()=>decodeCatalogChange({topic,partition:0,key:{id:'wrong'},
    value:event('r')},prefix),/row_scope/)
  assert.throws(()=>decodeCatalogChange({topic,partition:0,key:{id:'prod_1'},
    value:event('c',{...payload,metadata:{secret:'bad'}})},prefix),/row_scope/)
  assert.throws(()=>decodeCatalogChange({topic,partition:0,key:{id:'prod_1'},
    value:{...event('c'),source:{...event('c').source,name:'other'}}},prefix),/source_invalid/)
  assert.equal(decodeCatalogChange({topic,partition:0,key:{id:'prod_1'},
    value:null},prefix),null)
})

test('relation key preserves both sides and delete can use key with null before',()=>{
  const relationTopic=`${prefix}.public.product_category_product`
  const change=decodeCatalogChange({topic:relationTopic,partition:0,
    key:{product_id:'p1',product_category_id:'c1'},value:{op:'d',before:null,
      source:{name:prefix,db:'medusa',schema:'public',
        table:'product_category_product',lsn:43,snapshot:false}}},prefix)
  assert.equal(change.rowKey,'["p1","c1"]')
  assert.equal(change.data,null)
})

test('transactional offset rejects gaps, deduplicates replay and invalidates quality',async()=>{
  const statements=[]
  let expected=0
  const client={query:async(sql,params)=>{
    statements.push(sql)
    if(sql.includes('SELECT next_offset'))return {rows:expected?[{next_offset:expected}]:[]}
    return {rows:[]}
  }}
  const input={sourceId:'source-a',epochId:'epoch-a',prefix,topic,partition:0,
    offset:'0',key:{id:'prod_1'},value:event('r')}
  assert.deepEqual(await persistCatalogChange(client,input),{applied:true,change:'r'})
  assert.ok(statements.some(sql=>sql.includes('catalog_cdc_products_current')))
  assert.ok(statements.some(sql=>sql.includes("status='BLOCKED_BY_QUALITY'")))
  assert.equal(statements.at(-1),'COMMIT')
  expected=1; statements.length=0
  assert.deepEqual(await persistCatalogChange(client,input),{applied:false,change:'r'})
  assert.equal(statements.filter(sql=>sql.includes('catalog_cdc_products_current')).length,0)
  assert.equal(statements.at(-1),'COMMIT')
  await assert.rejects(persistCatalogChange(client,{...input,offset:'2'}),/offset_gap/)
  assert.equal(statements.at(-1),'ROLLBACK')
})
