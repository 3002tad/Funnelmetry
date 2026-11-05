import { createHash } from 'node:crypto'

const hash = value => createHash('sha256').update(value).digest('hex')
const canonicalTime = value => {
  const n = Date.parse(value)
  if (!Number.isFinite(n) || !/Z$/.test(value)) throw Error('invalid_utc_time')
  return new Date(n).toISOString()
}
const keyFor = (type, id) => `demo:${type}:${id}`
const types = new Set(['product', 'variant', 'category'])
const domainNames = ['browser', 'cart', 'catalog', 'order']

// Anchors are explicit candidate mappings, not evidence that a live source was verified.
export function buildFoundation(fixture, anchors = []) {
  const c = fixture.config
  const start = canonicalTime(c.start), cutover = canonicalTime(c.end)
  if (Date.parse(start) >= Date.parse(cutover)) throw Error('invalid_fixture_interval')
  if (!c.dataset_id || !c.source_id || c.source_id === 'medusa-reference' || !c.epoch || !Array.isArray(anchors)) throw Error('invalid_foundation_config')
  const entities = [
    ...fixture.products.map(p => ({ type:'product', id:p.product_id })),
    ...fixture.products.map(p => ({ type:'variant', id:p.variant_id })),
    ...fixture.categories.map(p => ({ type:'category', id:p.category_id })),
  ]
  const known = new Set(), crosswalk = []
  for (const entity of entities) {
    if (!types.has(entity.type) || typeof entity.id !== 'string' || !entity.id || known.has(`${entity.type}:${entity.id}`)) throw Error('invalid_or_duplicate_fixture_entity')
    known.add(`${entity.type}:${entity.id}`)
    crosswalk.push({ dataset_id:c.dataset_id, entity_type:entity.type, demo_entity_key:keyFor(entity.type,entity.id), source_id:c.source_id, source_entity_id:entity.id, valid_from:start, valid_to:cutover, origin:'SYNTHETIC_BACKFILL', mapping_status:'FIXTURE_ONLY', mapping_evidence:'fixture_entity_id' })
  }
  for (const a of anchors) {
    if (!types.has(a.entity_type) || !known.has(`${a.entity_type}:${a.synthetic_id}`) || typeof a.source_id !== 'string' || !a.source_id || a.source_id === c.source_id || typeof a.source_entity_id !== 'string' || !a.source_entity_id || typeof a.mapping_evidence !== 'string' || !a.mapping_evidence.trim()) throw Error('invalid_explicit_anchor')
    crosswalk.push({ dataset_id:c.dataset_id, entity_type:a.entity_type, demo_entity_key:keyFor(a.entity_type,a.synthetic_id), source_id:a.source_id, source_entity_id:a.source_entity_id, valid_from:cutover, valid_to:null, origin:'OBSERVED_SOURCE', mapping_status:'UNVERIFIED', mapping_evidence:a.mapping_evidence.trim() })
  }
  crosswalk.sort((a,b) => JSON.stringify([a.entity_type,a.demo_entity_key,a.source_id,a.source_entity_id]).localeCompare(JSON.stringify([b.entity_type,b.demo_entity_key,b.source_id,b.source_entity_id]),'en'))
  const bySource = new Set(), byEntity = new Set()
  for (const r of crosswalk) {
    const sourceKey = JSON.stringify([r.entity_type,r.source_id,r.source_entity_id]), entityKey = JSON.stringify([r.entity_type,r.source_id,r.demo_entity_key])
    if (bySource.has(sourceKey) || byEntity.has(entityKey)) throw Error('duplicate_or_ambiguous_anchor')
    bySource.add(sourceKey); byEntity.add(entityKey)
  }
  const coverage = []
  for (const domain of domainNames) {
    coverage.push({ dataset_id:c.dataset_id, domain, source_id:c.source_id, coverage_epoch_id:c.epoch, interval_start:start, interval_end:cutover, status:'COMPLETE', origin:'SYNTHETIC_BACKFILL', evidence:'SYNTHETIC_FIXTURE_ONLY', source_checkpoint:null })
    coverage.push({ dataset_id:c.dataset_id, domain, source_id:'medusa-reference', coverage_epoch_id:'PENDING', interval_start:cutover, interval_end:null, status:'UNVERIFIED', origin:'OBSERVED_SOURCE', evidence:'NO_LIVE_COVERAGE_EVIDENCE', source_checkpoint:null })
  }
  return { contract_version:'demo-foundation.v1', dataset_id:c.dataset_id, cutover_at:cutover, cutover_status:'PROVISIONAL_OFFLINE_ONLY', crosswalk, coverage }
}

export const foundationHash = value => hash(JSON.stringify(value))
