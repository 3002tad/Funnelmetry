// CDC-11 target-topology preflight. Read-only: no source DB, Kafka or Docker call.
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import path from 'node:path'

const specs = Object.freeze({
  order: {
    file: 'cdc-order-v2-shadow.json',
    version: 'funnelmetry-medusa-cdc-order-v2-shadow.v1',
    epoch: 'CDC_ORDER_EPOCH',
    prefix: 'CDC_ORDER_TOPIC_PREFIX',
    contract: 'reference.medusa.order_recorded_state.v2',
    contractField: 'cdc_reference_contract',
  },
  catalog: {
    file: 'cdc-catalog-shadow.json',
    version: 'funnelmetry-medusa-cdc-catalog-shadow.v2',
    epoch: 'CDC_CATALOG_EPOCH',
    prefix: 'CDC_CATALOG_TOPIC_PREFIX',
    contract: 'reference.medusa.catalog_master_data.v1',
    contractField: 'cdc_catalog_contract',
  },
  inventoryPrice: {
    file: 'cdc-inventory-price-shadow.json',
    version: 'funnelmetry-medusa-cdc-inventory-price-shadow.v3',
    epoch: 'CDC_INVENTORY_PRICE_EPOCH',
    prefix: 'CDC_INVENTORY_PRICE_TOPIC_PREFIX',
    contract: 'reference.medusa.inventory_price_context.v2',
    contractField: 'cdc_inventory_price_contract',
  },
  cart: {
    file: 'cdc-cart-line-item.json',
    version: 'funnelmetry-medusa-cdc-cart-line-item.v1',
    epoch: 'CDC_CART_EPOCH',
    prefix: 'CDC_CART_TOPIC_PREFIX',
    contract: 'reference.medusa.cart_line_item_added.v1',
    contractField: 'cdc_contract',
    status: 'ACTIVE_REFERENCE',
  },
})

function nonempty(value) {
  return typeof value === 'string' && value.length > 0
}

export function checkTargetProfiles(profiles, env) {
  if (!nonempty(env.CDC_SOURCE_ID)) throw Error('cdc_target_source_id_missing')
  const activeSpecs = env.CDC_CART_EPOCH ? specs : Object.fromEntries(
    Object.entries(specs).filter(([name]) => name !== 'cart'))
  const epochs = new Set(), slots = new Set(), publications = new Set(), prefixes = new Set()
  let medusaVersion
  for (const [name, spec] of Object.entries(activeSpecs)) {
    const profile = profiles[name]
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      throw Error(`cdc_target_${name}_profile_missing`)
    }
    if (profile.schema_version !== spec.version || profile.generated_by !== 'funnelmetry-medusa-ci' ||
        profile.status !== (spec.status ?? 'SHADOW_ONLY') || profile.snapshot_mode !== 'initial' ||
        profile[spec.contractField] !== spec.contract) {
      throw Error(`cdc_target_${name}_profile_contract_invalid`)
    }
    if (profile.source_id !== env.CDC_SOURCE_ID ||
        !nonempty(profile.medusa_version) ||
        (medusaVersion && profile.medusa_version !== medusaVersion)) {
      throw Error(`cdc_target_${name}_source_mismatch`)
    }
    medusaVersion = profile.medusa_version
    if (!nonempty(env[spec.epoch]) || !nonempty(env[spec.prefix]) ||
        profile.coverage_epoch_id !== env[spec.epoch] ||
        profile.topic_prefix !== env[spec.prefix]) {
      throw Error(`cdc_target_${name}_runtime_binding_mismatch`)
    }
    if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(profile.coverage_epoch_id) ||
        !/^[a-z][a-z0-9_]{2,62}$/.test(profile.topic_prefix) ||
        !/^[a-z][a-z0-9_]{2,62}$/.test(profile.slot) ||
        !/^[a-z][a-z0-9_]{2,62}$/.test(profile.publication) ||
        !/^[A-Z][A-Z0-9_]*$/.test(profile.source_db_url_ref)) {
      throw Error(`cdc_target_${name}_identifier_invalid`)
    }
    if (!Array.isArray(profile.table_columns) || !profile.table_columns.length ||
        new Set(profile.table_columns).size !== profile.table_columns.length) {
      throw Error(`cdc_target_${name}_allowlist_invalid`)
    }
    epochs.add(profile.coverage_epoch_id)
    slots.add(profile.slot)
    publications.add(profile.publication)
    prefixes.add(profile.topic_prefix)
  }
  if ([epochs, slots, publications, prefixes].some(values => values.size !== Object.keys(activeSpecs).length)) {
    throw Error('cdc_target_profile_resource_collision')
  }
  if (env.CDC_CART_EPOCH && (profiles.cart.baseline_policy !== 'SNAPSHOT_NEVER_EMITS_CART_ITEM_ADDED' ||
      profiles.cart.quantity_policy !== 'INSERT_OR_POSITIVE_DELTA_ONLY' ||
      profiles.cart.table_columns.length !== 1 ||
      profiles.cart.table_columns[0] !==
        'public.cart_line_item:id,cart_id,product_id,variant_id,quantity,created_at,updated_at,deleted_at')) {
    throw Error('cdc_target_cart_contract_invalid')
  }
  const order = profiles.order
  if (order.fact_topic !== env.CDC_ORDER_FACT_TOPIC ||
      !nonempty(order.fact_topic) || order.rollback_target !== undefined ||
      order.baseline_policy !== 'BASELINE_NEVER_ON' ||
      order.historical_gap_status !== 'INCOMPLETE' ||
      order.analytical_authority !== 'reference.medusa.order_recorded_state.v2' ||
      order.order_fact_authority !== undefined || order.canonical_live_event !== undefined) {
    throw Error('cdc_target_order_authority_invalid')
  }
  return { status: 'PROFILE_TOPOLOGY_MATCH', source_id: env.CDC_SOURCE_ID,
    medusa_version: medusaVersion, profiles: Object.fromEntries(
      Object.entries(activeSpecs).map(([name]) => [name, profiles[name].coverage_epoch_id])) }
}

async function main() {
  if (process.argv.length !== 4 || process.argv[2] !== '--medusa-root') {
    throw Error('usage: check-target-profiles.mjs --medusa-root <checkout>')
  }
  const profileRoot = path.join(path.resolve(process.argv[3]), 'funnelmetry')
  const activeSpecs = process.env.CDC_CART_EPOCH ? specs : Object.fromEntries(
    Object.entries(specs).filter(([name]) => name !== 'cart'))
  const profiles = Object.fromEntries(await Promise.all(Object.entries(activeSpecs).map(async ([name, spec]) =>
    [name, JSON.parse(await readFile(path.join(profileRoot, spec.file), 'utf8'))])))
  process.stdout.write(`${JSON.stringify(checkTargetProfiles(profiles, process.env))}\n`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => {
    console.error(`cdc-target-profiles: ${error.message}`)
    process.exitCode = 1
  })
}
