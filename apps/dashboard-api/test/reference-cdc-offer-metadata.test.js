import test from 'node:test';
import assert from 'node:assert/strict';
import { createReferenceOfferMetadataOperator, readReferenceOfferMetadata,
  REFERENCE_OFFER_ASSET } from '../src/lib/reference-cdc-offer-metadata.js';
import { STAGE2_TABLES } from '../src/lib/reference-cdc-offer.js';

const scope = {
  sourceId: 'medusa-reference', catalogEpochId: 'catalog_epoch',
  stage2EpochId: 'stage2_epoch', decisionRef: 'DEC-140-2026-10-30',
};

function database({ leaseReady = true, columns = true, releaseDocument = REFERENCE_OFFER_ASSET } = {}) {
  let release = null;
  let binding = null;
  const rows = [];
  for (const [table, names] of Object.entries({
    catalog_cdc_products_current: ['source_id','coverage_epoch_id','product_id','status','soft_deleted'],
    catalog_cdc_variants_current: ['source_id','coverage_epoch_id','variant_id','product_id','soft_deleted'],
    inventory_price_cdc_context_current: ['source_id','coverage_epoch_id','table_name','payload','soft_deleted'],
    catalog_cdc_quality_lease: ['source_id','coverage_epoch_id','status','valid_until'],
    inventory_price_cdc_quality_lease: ['source_id','coverage_epoch_id','status','valid_until'],
  })) for (const column_name of names) rows.push({table_name:table,column_name});
  const client = {
    async query(sql) {
      if (sql.includes('FROM information_schema.columns')) return {rows: columns ? rows : rows.slice(1)};
      if (sql.includes('FROM catalog_cdc_binding b')) return {rows: [{ready:leaseReady,
        catalog_epoch_id:'catalog_epoch',stage2_epoch_id:'stage2_epoch',
        stage2_source_row_counts:Object.fromEntries(STAGE2_TABLES.map(table=>[table,1]))}]};
      if (sql.startsWith('INSERT INTO reference_current_offer_metadata_releases')) {
        release ??= {asset_id:REFERENCE_OFFER_ASSET.asset_id,asset_version:'1.0.0',
          contract_id:REFERENCE_OFFER_ASSET.contract_id,definition:releaseDocument,
          published_at:new Date('2026-10-30T00:00:00Z')};
      }
      if (sql.startsWith('SELECT asset_id,asset_version')) return {rows:release?[release]:[]};
      if (sql.startsWith('INSERT INTO reference_current_offer_metadata_bindings')) {
        binding ??= {source_id:'medusa-reference',asset_id:REFERENCE_OFFER_ASSET.asset_id,
          asset_version:'1.0.0',catalog_epoch_id:'catalog_epoch',stage2_epoch_id:'stage2_epoch',state:'SHADOW'};
      }
      if (sql.startsWith('SELECT source_id,asset_id')) return {rows:binding?[binding]:[]};
      if (sql.startsWith('UPDATE reference_current_offer_metadata_bindings')) binding.state='ACTIVE';
      return {rows:[]};
    },
    release() {},
  };
  return {pool:{connect:async()=>client},setLeaseReady(value){leaseReady=value}};
}

test('metadata release is versioned, current-only and has no Agent tool', () => {
  assert.equal(REFERENCE_OFFER_ASSET.asset_id,'asset.reference_medusa_current_offer');
  assert.deepEqual(REFERENCE_OFFER_ASSET.grain,
    ['source_id','variant_id','sales_channel_id','region_id','currency_code']);
  assert.equal(REFERENCE_OFFER_ASSET.execution_binding.endpoint,'/api/v2/reference-cdc/current-offer');
  assert.equal('tool_id' in REFERENCE_OFFER_ASSET,false);
  assert.match(REFERENCE_OFFER_ASSET.limitations.join(' '),/historical order-price/);
});

test('operator publishes SHADOW then activates only with matching fresh CDC leases', async () => {
  const db=database();
  const operator=createReferenceOfferMetadataOperator(db);
  assert.equal((await operator.publishShadow(scope)).state,'SHADOW');
  assert.equal((await operator.activate(scope)).state,'ACTIVE');
  assert.equal((await operator.publishShadow(scope)).state,'ACTIVE');
  const metadata=await readReferenceOfferMetadata(db.pool);
  assert.equal(metadata.status,'ACTIVE');
  assert.equal(metadata.runtime_availability,'REFERENCE_CURRENT_ONLY');
  db.setLeaseReady(false);
  assert.equal((await readReferenceOfferMetadata(db.pool)).runtime_availability,'BLOCKED_BY_QUALITY');
  await assert.rejects(operator.activate(scope),/binding_not_ready/);
});

test('operator fails closed for missing columns, altered release or wrong source', async () => {
  await assert.rejects(createReferenceOfferMetadataOperator({pool:database({columns:false}).pool})
    .publishShadow(scope),/binding_not_ready/);
  await assert.rejects(createReferenceOfferMetadataOperator({pool:database({releaseDocument:{}}).pool})
    .publishShadow(scope),/release_conflict/);
  await assert.rejects(createReferenceOfferMetadataOperator({pool:database().pool})
    .publishShadow({...scope,sourceId:'other-source'}),/scope_invalid/);
});
