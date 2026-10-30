import { isDeepStrictEqual } from 'node:util';
import { LEASE_RECHECK_SQL } from './reference-cdc-offer-lease.js';
import { STAGE2_TABLES } from './reference-cdc-offer.js';

export const REFERENCE_OFFER_ASSET = Object.freeze({
  asset_id: 'asset.reference_medusa_current_offer',
  asset_version: '1.0.0',
  contract_id: 'reference.medusa.current_offer.v1',
  display_name: 'Medusa reference current offer',
  source_scope: 'medusa-reference',
  grain: ['source_id', 'variant_id', 'sales_channel_id', 'region_id', 'currency_code'],
  time_basis: 'current CDC projection at quality-lease verification time',
  authority: 'Medusa PostgreSQL changes captured by the catalog and inventory/price CDC streams',
  execution_binding: {
    kind: 'parameterized_read',
    endpoint: '/api/v2/reference-cdc/current-offer',
    product_relation: 'public.catalog_cdc_products_current',
    variant_relation: 'public.catalog_cdc_variants_current',
    context_relation: 'public.inventory_price_cdc_context_current',
    catalog_lease: 'public.catalog_cdc_quality_lease',
    stage2_lease: 'public.inventory_price_cdc_quality_lease',
  },
  relationships: [
    { from: 'variant_id', to: 'product_id', cardinality: 'many_to_one',
      rule: 'variant.product_id must equal the selected product; never aggregate joined context rows' },
    { from: 'sales_channel_id', to: 'stock_location_id', cardinality: 'many_to_many',
      rule: 'resolve the location set before inventory; never infer from one inventory_level row' },
  ],
  output_fields: [
    { id: 'price', unit: 'requested currency', availability: ['PASS_SAMPLE_ONLY', 'UNVERIFIED'] },
    { id: 'inventory', unit: 'source units', availability: ['PASS_SAMPLE_ONLY', 'UNVERIFIED'] },
  ],
  quality_requirements: [
    'catalog binding ACTIVE with complete snapshot and fresh PASS lease',
    'stage-2 16-table snapshot and fresh PASS lease',
    'source and projection digests/counts and topic offsets equal',
    'replication slot and connector ready',
    'unsupported price or stock shape returns UNVERIFIED independently',
  ],
  supported_operation: 'single_current_offer_lookup',
  limitations: [
    'Current Medusa reference only; no historical order-price rewrite',
    'No general sellable-stock or customer-specific price claim',
    'No revenue, conversion, catalog-wide aggregation, or Agent tool binding',
  ],
});

const RELEASE_SQL = `SELECT asset_id,asset_version,contract_id,definition,published_at
  FROM reference_current_offer_metadata_releases WHERE asset_id=$1 AND asset_version=$2`;
const BINDING_SQL = `SELECT source_id,asset_id,asset_version,catalog_epoch_id,stage2_epoch_id,
    state,decision_ref,activated_at
  FROM reference_current_offer_metadata_bindings
  WHERE source_id=$1 AND asset_id=$2 AND asset_version=$3`;
const REQUIRED_COLUMNS = Object.freeze({
  catalog_cdc_products_current: ['source_id', 'coverage_epoch_id', 'product_id', 'status', 'soft_deleted'],
  catalog_cdc_variants_current: ['source_id', 'coverage_epoch_id', 'variant_id', 'product_id', 'soft_deleted'],
  inventory_price_cdc_context_current: ['source_id', 'coverage_epoch_id', 'table_name', 'payload', 'soft_deleted'],
  catalog_cdc_quality_lease: ['source_id', 'coverage_epoch_id', 'status', 'valid_until'],
  inventory_price_cdc_quality_lease: ['source_id', 'coverage_epoch_id', 'status', 'valid_until'],
});

function exactRelease(row) {
  return row?.asset_id === REFERENCE_OFFER_ASSET.asset_id &&
    row.asset_version === REFERENCE_OFFER_ASSET.asset_version &&
    row.contract_id === REFERENCE_OFFER_ASSET.contract_id &&
    isDeepStrictEqual(row.definition, REFERENCE_OFFER_ASSET);
}

function validScope(input) {
  const id = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
  if (input?.sourceId !== 'medusa-reference' ||
      !id.test(input.catalogEpochId ?? '') || !id.test(input.stage2EpochId ?? '') ||
      typeof input.decisionRef !== 'string' ||
      !/^DEC-[0-9]+(?:[/:._ A-Za-z0-9-]{0,160})$/.test(input.decisionRef)) {
    throw Error('reference_offer_metadata_scope_invalid');
  }
  return input;
}

async function ready(client, scope) {
  const lease = (await client.query(LEASE_RECHECK_SQL, [scope.sourceId])).rows[0];
  return lease?.ready === true &&
    lease.catalog_epoch_id === scope.catalogEpochId &&
    lease.stage2_epoch_id === scope.stage2EpochId &&
    STAGE2_TABLES.every(table => Object.hasOwn(lease.stage2_source_row_counts ?? {}, table));
}

async function physicalBindingExists(client) {
  const { rows } = await client.query(`SELECT table_name,column_name FROM information_schema.columns
    WHERE table_schema='public' AND table_name = ANY($1::text[])`,
  [Object.keys(REQUIRED_COLUMNS)]);
  return Object.entries(REQUIRED_COLUMNS).every(([table, columns]) =>
    columns.every(column => rows.some(row => row.table_name === table && row.column_name === column)));
}

async function transaction(pool, work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout='10s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('reference-current-offer-metadata'))");
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}

export function createReferenceOfferMetadataOperator({ pool } = {}) {
  if (!pool?.connect) throw Error('reference_offer_metadata_pool_required');
  return Object.freeze({
    async publishShadow(input) {
      const scope = validScope(input);
      return transaction(pool, async client => {
        if (!await ready(client, scope) || !await physicalBindingExists(client)) {
          throw Error('reference_offer_metadata_binding_not_ready');
        }
        await client.query(`INSERT INTO reference_current_offer_metadata_releases
          (asset_id,asset_version,contract_id,definition)
          VALUES($1,$2,$3,$4::jsonb) ON CONFLICT DO NOTHING`,
        [REFERENCE_OFFER_ASSET.asset_id, REFERENCE_OFFER_ASSET.asset_version,
          REFERENCE_OFFER_ASSET.contract_id, JSON.stringify(REFERENCE_OFFER_ASSET)]);
        const release = (await client.query(RELEASE_SQL,
          [REFERENCE_OFFER_ASSET.asset_id, REFERENCE_OFFER_ASSET.asset_version])).rows[0];
        if (!exactRelease(release)) throw Error('reference_offer_metadata_release_conflict');
        await client.query(`INSERT INTO reference_current_offer_metadata_bindings
          (source_id,asset_id,asset_version,catalog_epoch_id,stage2_epoch_id,state,decision_ref)
          VALUES($1,$2,$3,$4,$5,'SHADOW',$6) ON CONFLICT DO NOTHING`,
        [scope.sourceId, REFERENCE_OFFER_ASSET.asset_id, REFERENCE_OFFER_ASSET.asset_version,
          scope.catalogEpochId, scope.stage2EpochId, scope.decisionRef]);
        const binding = (await client.query(BINDING_SQL,
          [scope.sourceId, REFERENCE_OFFER_ASSET.asset_id, REFERENCE_OFFER_ASSET.asset_version])).rows[0];
        if (binding?.catalog_epoch_id !== scope.catalogEpochId ||
            binding.stage2_epoch_id !== scope.stage2EpochId || !['SHADOW', 'ACTIVE'].includes(binding.state)) {
          throw Error('reference_offer_metadata_binding_conflict');
        }
        return { state: binding.state, asset_id: REFERENCE_OFFER_ASSET.asset_id,
          asset_version: REFERENCE_OFFER_ASSET.asset_version };
      });
    },
    async activate(input) {
      const scope = validScope(input);
      return transaction(pool, async client => {
        if (!await ready(client, scope) || !await physicalBindingExists(client)) {
          throw Error('reference_offer_metadata_binding_not_ready');
        }
        const release = (await client.query(RELEASE_SQL,
          [REFERENCE_OFFER_ASSET.asset_id, REFERENCE_OFFER_ASSET.asset_version])).rows[0];
        if (!exactRelease(release)) throw Error('reference_offer_metadata_release_unverified');
        const binding = (await client.query(BINDING_SQL,
          [scope.sourceId, REFERENCE_OFFER_ASSET.asset_id, REFERENCE_OFFER_ASSET.asset_version])).rows[0];
        if (binding?.state !== 'SHADOW' && binding?.state !== 'ACTIVE' ||
            binding.catalog_epoch_id !== scope.catalogEpochId ||
            binding.stage2_epoch_id !== scope.stage2EpochId) {
          throw Error('reference_offer_metadata_binding_unverified');
        }
        if (binding.state === 'SHADOW') await client.query(`UPDATE reference_current_offer_metadata_bindings
          SET state='ACTIVE',activated_at=clock_timestamp(),decision_ref=$4,
              updated_at=clock_timestamp()
          WHERE source_id=$1 AND asset_id=$2 AND asset_version=$3 AND state='SHADOW'`,
        [scope.sourceId, REFERENCE_OFFER_ASSET.asset_id,
          REFERENCE_OFFER_ASSET.asset_version, scope.decisionRef]);
        return { state: 'ACTIVE', asset_id: REFERENCE_OFFER_ASSET.asset_id,
          asset_version: REFERENCE_OFFER_ASSET.asset_version };
      });
    },
  });
}

export async function readReferenceOfferMetadata(pool, sourceId = 'medusa-reference') {
  if (sourceId !== 'medusa-reference') throw Error('reference_offer_metadata_source_invalid');
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    await client.query("SET LOCAL statement_timeout='5s'");
    const release = (await client.query(RELEASE_SQL,
      [REFERENCE_OFFER_ASSET.asset_id, REFERENCE_OFFER_ASSET.asset_version])).rows[0];
    const binding = (await client.query(BINDING_SQL,
      [sourceId, REFERENCE_OFFER_ASSET.asset_id, REFERENCE_OFFER_ASSET.asset_version])).rows[0];
    if (!exactRelease(release) || binding?.state !== 'ACTIVE' ||
        !await physicalBindingExists(client)) throw Error('reference_offer_metadata_unverified');
    return { status: 'ACTIVE', runtime_availability: await ready(client, {
      sourceId, catalogEpochId: binding.catalog_epoch_id,
      stage2EpochId: binding.stage2_epoch_id,
    }) ? 'REFERENCE_CURRENT_ONLY' : 'BLOCKED_BY_QUALITY',
    source_id: sourceId, catalog_epoch_id: binding.catalog_epoch_id,
    stage2_epoch_id: binding.stage2_epoch_id, published_at: release.published_at,
    definition: release.definition };
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}
