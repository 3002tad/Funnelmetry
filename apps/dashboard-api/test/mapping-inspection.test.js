import test from 'node:test'
import assert from 'node:assert/strict'
import {inspectMappingDocument,loadMappingInspection} from '../src/lib/mapping-inspection.js'
test('mapping inspection reads fixed artifact and never claims active runtime',async()=>{
  const r=await loadMappingInspection()
  assert.equal(r.runtime_status,'UNVERIFIED');assert.equal(r.read_only,true)
  assert.match(r.sha256,/^[a-f0-9]{64}$/)
  assert.deepEqual(r.mappings,[])
})
test('mapping inspection rejects invalid or duplicate selectors and allowlists output',async()=>{
  const r=await loadMappingInspection()
  assert.throws(()=>inspectMappingDocument({...r,schema_version:'wrong'}))
  const valid={source_event_type:'x',source_schema_version:'1',event_type:'x',event_class:'CLIENT_OBSERVATION',mapping_version:'x-v1'}
  assert.throws(()=>inspectMappingDocument({...r,mappings:[valid,valid]}))
  assert.throws(()=>inspectMappingDocument({...r,mappings:[{...valid,event_type:null}]}))
  assert.equal(JSON.stringify(inspectMappingDocument({...r,secret:'PRIVATE',mappings:[{...valid,secret:'PRIVATE'}]})).includes('PRIVATE'),false)
})
