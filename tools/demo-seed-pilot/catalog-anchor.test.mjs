import test from 'node:test'
import assert from 'node:assert/strict'
import { reconcileCatalog } from './catalog-anchor.mjs'

const source={captured_at:'2026-11-05T08:16:00Z',wal_lsn:'0/34F06D0',products:[{id:'prod_1'}],variants:[{id:'var_1',product_id:'prod_1'}],categories:[{id:'cat_1'}],product_categories:[{product_id:'prod_1',category_id:'cat_1'}]}
const projection={...structuredClone(source),captured_at:'2026-11-05T08:16:05Z',lease:{status:'PASS',counts_match:true,digest_match:true,offsets_match:true,coverage_epoch_id:'epoch',verified_at:'2026-11-05T08:16:02Z',valid_until:'2026-11-05T08:20:00Z'}}
const evidence={source_sha256:'a'.repeat(64),projection_sha256:'b'.repeat(64)}
test('source IDs and relationships yield stable snapshot anchors',()=>{
  const result=reconcileCatalog(source,projection,evidence)
  assert.deepEqual(result.counts,{products:1,variants:1,categories:1,product_categories:1})
  assert.equal(result.entities.length,3)
  assert.equal(result.live_cutover_status,'UNVERIFIED')
  assert.equal(result.relations.variants[0].product_key,result.entities.find(e=>e.entity_type==='product').demo_entity_key)
  assert.equal(result.synthetic_catalog.variants[0].product_id,result.synthetic_catalog.products[0].product_id)
  assert.deepEqual(result,reconcileCatalog(source,projection,evidence))
})
test('rejects stale lease, mismatched IDs and orphan relationships',()=>{
  assert.throws(()=>reconcileCatalog(source,{...projection,lease:{...projection.lease,valid_until:'2026-11-05T08:16:04Z'}},evidence),/lease_not_valid/)
  assert.throws(()=>reconcileCatalog(source,{...projection,products:[{id:'different'}]},evidence),/snapshot_mismatch_products/)
  const a=structuredClone(source), b=structuredClone(projection);a.variants[0].product_id='missing';b.variants[0].product_id='missing'
  assert.throws(()=>reconcileCatalog(a,b,evidence),/catalog_orphan_relation/)
  assert.throws(()=>reconcileCatalog(source,{...projection,captured_at:'2026-11-05T09:16:05Z'},evidence),/snapshot_order_or_evidence_invalid|lease_not_valid/)
})
