import assert from 'node:assert/strict'
import test from 'node:test'
import { checkTargetProfiles } from './check-target-profiles.mjs'

const env = {
  CDC_SOURCE_ID: 'medusa-reference',
  CDC_ORDER_EPOCH: 'cdc11_order_epoch1',
  CDC_CATALOG_EPOCH: 'cdc11_catalog_epoch1',
  CDC_INVENTORY_PRICE_EPOCH: 'cdc11_inventory_price_epoch1',
  CDC_ORDER_TOPIC_PREFIX: 'cdc_shadow_medusa_order_v2_e1',
  CDC_CATALOG_TOPIC_PREFIX: 'cdc_shadow_medusa_catalog',
  CDC_INVENTORY_PRICE_TOPIC_PREFIX: 'cdc_shadow_medusa_inventory_price_v2',
  CDC_ORDER_FACT_TOPIC: 'cdc_shadow_reference.order_recorded_state.v2',
}

function profile(version, contractField, contract, epoch, prefix, slot) {
  return { schema_version: version, generated_by: 'funnelmetry-medusa-ci',
    status: 'SHADOW_ONLY', source_id: env.CDC_SOURCE_ID, medusa_version: '2.19.0',
    [contractField]: contract, coverage_epoch_id: epoch, snapshot_mode: 'initial',
    topic_prefix: prefix, slot, publication: slot,
    source_db_url_ref: 'FUNNELMETRY_CDC_DATABASE_URL',
    table_columns: ['public.table:id'] }
}

function fixture() {
  const order = profile('funnelmetry-medusa-cdc-order-v2-shadow.v1',
    'cdc_reference_contract', 'reference.medusa.order_recorded_state.v2',
    env.CDC_ORDER_EPOCH, env.CDC_ORDER_TOPIC_PREFIX, 'order_slot')
  Object.assign(order, { fact_topic: env.CDC_ORDER_FACT_TOPIC,
    rollback_target: 'native_order_placed', baseline_policy: 'BASELINE_NEVER_ON',
    historical_gap_status: 'INCOMPLETE', order_fact_authority: 'medusa.order_placed' })
  return {
    order,
    catalog: profile('funnelmetry-medusa-cdc-catalog-shadow.v2',
      'cdc_catalog_contract', 'reference.medusa.catalog_master_data.v1',
      env.CDC_CATALOG_EPOCH, env.CDC_CATALOG_TOPIC_PREFIX, 'catalog_slot'),
    inventoryPrice: profile('funnelmetry-medusa-cdc-inventory-price-shadow.v3',
      'cdc_inventory_price_contract', 'reference.medusa.inventory_price_context.v2',
      env.CDC_INVENTORY_PRICE_EPOCH, env.CDC_INVENTORY_PRICE_TOPIC_PREFIX,
      'inventory_price_slot'),
  }
}

test('three generated CDC epochs and namespaces must match the target stack', () => {
  const profiles = fixture()
  assert.equal(checkTargetProfiles(profiles, env).status, 'PROFILE_TOPOLOGY_MATCH')
  assert.throws(() => checkTargetProfiles(profiles, { ...env,
    CDC_CATALOG_EPOCH: 'another_epoch' }), /runtime_binding_mismatch/)
  assert.throws(() => checkTargetProfiles(profiles, { ...env,
    CDC_SOURCE_ID: 'another-source' }), /source_mismatch/)
  profiles.inventoryPrice.slot = profiles.catalog.slot
  assert.throws(() => checkTargetProfiles(profiles, env), /resource_collision/)
})

test('legacy, incomplete and promoted profiles fail closed', () => {
  const profiles = fixture()
  profiles.catalog.schema_version = 'funnelmetry-medusa-cdc-catalog-shadow.v1'
  assert.throws(() => checkTargetProfiles(profiles, env), /profile_contract_invalid/)
  profiles.catalog = fixture().catalog
  delete profiles.catalog.coverage_epoch_id
  assert.throws(() => checkTargetProfiles(profiles, env), /runtime_binding_mismatch/)
  profiles.catalog = fixture().catalog
  profiles.order.status = 'LIVE'
  assert.throws(() => checkTargetProfiles(profiles, env), /profile_contract_invalid/)
})
