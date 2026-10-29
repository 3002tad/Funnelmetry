import test from 'node:test'
import assert from 'node:assert/strict'
import {decodeContextChange, fieldsByTable, persistContextChange} from '../src/projection.js'

const prefix = 'cdc_shadow_medusa_inventory_price_v2'
const topic = `${prefix}.public.inventory_level`
const key = {id:'ilevel_1'}
const row = {id:'ilevel_1', inventory_item_id:'iitem_1', location_id:'sloc_1',
  stocked_quantity:10, reserved_quantity:2, incoming_quantity:0, deleted_at:null}
function envelope(op='r', after=row, marker='last') {
  return {op, source:{name:prefix, db:'medusa', schema:'public',
    table:'inventory_level', lsn:123, snapshot:marker}, after}
}

test('stage-2 writer allowlist matches the versioned profile', async () => {
  const {readFile} = await import('node:fs/promises')
  const profile = await readFile(new URL('../../../tools/medusa-reference-cdc-shadow/install-inventory-price-shadow.py',
    import.meta.url), 'utf8')
  for (const [table, fields] of Object.entries(fieldsByTable)) {
    assert.match(profile, new RegExp(`"${table}": \\(`))
    assert.ok(fields.includes('deleted_at'))
  }
  assert.equal(Object.keys(fieldsByTable).length, 16)
})

test('accepts snapshot, update, soft delete, hard delete and tombstone', () => {
  assert.deepEqual(decodeContextChange({topic,partition:0,key,value:envelope()},prefix).rowKey,
    ['ilevel_1'])
  assert.equal(decodeContextChange({topic,partition:0,key,
    value:envelope('u',{...row,deleted_at:'2026-10-29T00:00:00Z'},false)},prefix).op,'u')
  assert.equal(decodeContextChange({topic,partition:0,key,
    value:{...envelope('d',null,false),before:row}},prefix).data,null)
  assert.equal(decodeContextChange({topic,partition:0,key,value:null},prefix),null)
})

test('composite relation and currency keys use source primary keys', () => {
  const relationTopic = `${prefix}.public.product_sales_channel`
  const relation = {id:'link_1',product_id:'prod_1',sales_channel_id:'sc_1',deleted_at:null}
  const source = {name:prefix,db:'medusa',schema:'public',table:'product_sales_channel',
    lsn:123,snapshot:true}
  assert.deepEqual(decodeContextChange({topic:relationTopic,partition:0,
    key:{product_id:'prod_1',sales_channel_id:'sc_1'},value:{op:'r',source,after:relation}},
  prefix).rowKey,['prod_1','sc_1'])
  assert.throws(() => decodeContextChange({topic:relationTopic,partition:0,
    key:{id:'link_1'},value:{op:'r',source,after:relation}},prefix),/key_invalid/)
  const currencyTopic = `${prefix}.public.currency`
  assert.deepEqual(decodeContextChange({topic:currencyTopic,partition:0,key:{code:'eur'},
    value:{op:'r',source:{...source,table:'currency'},
      after:{code:'eur',decimal_digits:2,deleted_at:null}}},prefix).rowKey,['eur'])
})

test('rejects foreign source, extra columns and offset partition', () => {
  assert.throws(() => decodeContextChange({topic,partition:1,key,value:envelope()},prefix),/topic_invalid/)
  assert.throws(() => decodeContextChange({topic,partition:0,key,
    value:{...envelope(),source:{...envelope().source,db:'other'}}},prefix),/source_invalid/)
  assert.throws(() => decodeContextChange({topic,partition:0,key,
    value:envelope('r',{...row,secret:'outside-allowlist'})},prefix),/row_scope_invalid/)
})

function client(nextOffset='0') {
  const calls=[]
  return {calls,async query(sql,params) {
    calls.push({sql,params})
    return {rows:sql.includes('SELECT next_offset') ? [{next_offset:nextOffset}] : []}
  }}
}
const base = {sourceId:'medusa-reference',epochId:'epoch_1',prefix,topic,partition:0,
  key,value:envelope(),offset:'0'}

test('applies row, audit and offset in one transaction', async () => {
  const db=client()
  assert.deepEqual(await persistContextChange(db,base),{applied:true,change:'r'})
  const sql=db.calls.map(call=>call.sql).join('\n')
  assert.match(sql,/inventory_price_cdc_ingest_audit/)
  assert.match(sql,/inventory_price_cdc_context_current/)
  assert.match(sql,/inventory_price_cdc_input_offsets/)
  assert.match(sql,/inventory_price_cdc_quality_lease/)
  assert.equal(db.calls.at(-1).sql,'COMMIT')
})

test('replay is idempotent and a forward offset gap rolls back', async () => {
  const replay=client('1')
  assert.deepEqual(await persistContextChange(replay,base),{applied:false,change:'r'})
  assert.equal(replay.calls.filter(call=>call.sql.includes('INSERT')).length,0)
  const gap=client('0')
  await assert.rejects(persistContextChange(gap,{...base,offset:'2'}),/offset_gap/)
  assert.equal(gap.calls.at(-1).sql,'ROLLBACK')
})
