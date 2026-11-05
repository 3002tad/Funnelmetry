import { createHash } from 'node:crypto'

const digest = s => createHash('sha256').update(s).digest('hex')
const types = {products:'product',variants:'variant',categories:'category'}
const stable = x => JSON.stringify(Object.keys(x).sort().map(k=>[k,x[k]]))
const date = (x,label) => { const t=Date.parse(x); if(!Number.isFinite(t)) throw Error(`invalid_${label}`); return t }

// Reconciles point-in-time source IDs and CDC projection. This is not a live cutover.
export function reconcileCatalog(source, projection, evidence) {
  const sourceTime=date(source.captured_at,'source_time'), targetTime=date(projection.captured_at,'projection_time')
  const lease=projection.lease
  if (!lease || lease.status!=='PASS' || !lease.counts_match || !lease.digest_match || !lease.offsets_match || !lease.coverage_epoch_id || date(lease.verified_at,'verified_at')>targetTime || date(lease.valid_until,'valid_until')<=targetTime) throw Error('catalog_lease_not_valid_at_projection_snapshot')
  if (sourceTime>targetTime || targetTime-sourceTime>120000 || !/^\w+\/\w+$/.test(source.wal_lsn??'') || !/^[a-f0-9]{64}$/.test(evidence?.source_sha256??'') || !/^[a-f0-9]{64}$/.test(evidence?.projection_sha256??'')) throw Error('snapshot_order_or_evidence_invalid')
  const sets={}
  for(const name of ['products','variants','categories','product_categories']) {
    if (!Array.isArray(source[name]) || !Array.isArray(projection[name])) throw Error(`missing_${name}`)
    const s=source[name].map(stable).sort(), p=projection[name].map(stable).sort()
    if (new Set(s).size!==s.length || new Set(p).size!==p.length || JSON.stringify(s)!==JSON.stringify(p)) throw Error(`snapshot_mismatch_${name}`)
    sets[name]=source[name]
  }
  const ids={}
  for (const name of Object.keys(types)) {
    ids[name]=new Set(sets[name].map(x=>x.id))
    if (ids[name].size!==sets[name].length || [...ids[name]].some(x=>typeof x!=='string'||!x)) throw Error(`invalid_ids_${name}`)
  }
  if (sets.variants.some(v=>!ids.products.has(v.product_id)) || sets.product_categories.some(x=>!ids.products.has(x.product_id)||!ids.categories.has(x.category_id))) throw Error('catalog_orphan_relation')
  const key=(type,id)=>`demo:${type}:${digest(`medusa-reference:${type}:${id}`).slice(0,32)}`
  const entities=Object.entries(types).flatMap(([name,type])=>sets[name].map(row=>({entity_type:type,demo_entity_key:key(type,row.id),source_id:'medusa-reference',source_entity_id:row.id,origin:'OBSERVED_SOURCE',mapping_status:'SNAPSHOT_VERIFIED',snapshot_at:source.captured_at,coverage_epoch_id:lease.coverage_epoch_id,mapping_evidence:`sha256:${evidence.source_sha256}:${evidence.projection_sha256}`})))
  const relations={variants:sets.variants.map(x=>({variant_key:key('variant',x.id),product_key:key('product',x.product_id)})),product_categories:sets.product_categories.map(x=>({product_key:key('product',x.product_id),category_key:key('category',x.category_id)}))}
  const counts=Object.fromEntries(Object.keys(sets).map(k=>[k,sets[k].length]))
  const syntheticCatalog={products:entities.filter(e=>e.entity_type==='product').map(e=>({product_id:e.demo_entity_key})),variants:relations.variants.map(r=>({variant_id:r.variant_key,product_id:r.product_key})),categories:entities.filter(e=>e.entity_type==='category').map(e=>({category_id:e.demo_entity_key})),product_categories:relations.product_categories.map(r=>({product_id:r.product_key,category_id:r.category_key}))}
  return {version:'demo-catalog-anchor-snapshot.v1',status:'SNAPSHOT_VERIFIED',source_id:'medusa-reference',source_captured_at:source.captured_at,projection_captured_at:projection.captured_at,wal_lsn:source.wal_lsn,lease_epoch:lease.coverage_epoch_id,lease_verified_at:lease.verified_at,lease_valid_until:lease.valid_until,scope:'CATALOG_POINT_IN_TIME_ONLY',live_cutover_status:'UNVERIFIED',historical_coverage:'UNVERIFIED',source_snapshot_sha256:evidence.source_sha256,projection_snapshot_sha256:evidence.projection_sha256,counts,entities,relations,synthetic_catalog:syntheticCatalog}
}
