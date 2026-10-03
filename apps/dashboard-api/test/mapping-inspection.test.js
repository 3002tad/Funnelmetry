import test from 'node:test'
import assert from 'node:assert/strict'
import {inspectMappingDocument,loadMappingInspection} from '../src/lib/mapping-inspection.js'
test('mapping inspection reads fixed artifact and never claims active runtime',async()=>{
  const r=await loadMappingInspection()
  assert.equal(r.runtime_status,'UNVERIFIED');assert.equal(r.read_only,true)
  assert.match(r.sha256,/^[a-f0-9]{64}$/)
  assert.ok(r.mappings.some(m=>m.source_event_type==='medusa.order_placed'&&m.event_type==='order.placed'&&m.source_schema_version==='2.0'))
})
test('mapping inspection rejects invalid or duplicate selectors and allowlists output',async()=>{
  const r=await loadMappingInspection()
  assert.throws(()=>inspectMappingDocument({...r,schema_version:'wrong'}))
  assert.throws(()=>inspectMappingDocument({...r,mappings:[r.mappings[0],r.mappings[0]]}))
  assert.throws(()=>inspectMappingDocument({...r,mappings:[{...r.mappings[0],event_type:null}]}))
  assert.equal(JSON.stringify(inspectMappingDocument({...r,secret:'PRIVATE',mappings:[{...r.mappings[0],secret:'PRIVATE'}]})).includes('PRIVATE'),false)
})
