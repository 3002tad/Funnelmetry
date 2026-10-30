import assert from 'node:assert/strict'
import test from 'node:test'
import { targetTopicSpecs } from './install-target-topics.mjs'

const profile = (prefix, tables) => ({ status: 'SHADOW_ONLY', snapshot_mode: 'initial',
  topic_prefix: prefix, table_columns: tables.map(table => `public.${table}:id`) })
const fixture = () => ({
  order: { ...profile('cdc_shadow_medusa_order_v2_e1', ['order', 'order_cart', 'cart']),
    fact_topic: 'cdc_shadow_reference.order_recorded_state.v2' },
  catalog: profile('cdc_shadow_medusa_catalog',
    ['product', 'product_variant', 'product_category', 'product_category_product']),
  inventoryPrice: profile('cdc_shadow_medusa_inventory_price_v2',
    ['product_sales_channel', 'sales_channel', 'sales_channel_stock_location',
      'stock_location', 'product_variant_inventory_item', 'inventory_item',
      'inventory_level', 'reservation_item', 'product_variant_price_set',
      'price_set', 'price', 'price_list', 'price_rule', 'price_list_rule',
      'region', 'currency']),
})

test('all three CDC profiles produce distinct snapshot, transaction, heartbeat and fact topics', () => {
  const names = targetTopicSpecs(fixture()).map(item => item.topic)
  assert.equal(names.length, 30)
  assert.equal(new Set(names).size, 30)
  assert.ok(names.includes('cdc_shadow_medusa_catalog.public.product'))
  assert.ok(names.includes('cdc_shadow_medusa_inventory_price_v2.public.inventory_level'))
  assert.ok(names.includes('cdc_shadow_medusa_order_v2_e1.public.order'))
  assert.ok(names.includes('cdc_shadow_medusa_order_v2_e1.transaction'))
  assert.ok(names.includes('cdc_shadow_reference.order_recorded_state.v2'))
})

test('duplicate prefix or broadened table set fails before broker mutation', () => {
  const samePrefix = fixture()
  samePrefix.catalog.topic_prefix = samePrefix.order.topic_prefix
  assert.throws(() => targetTopicSpecs(samePrefix), /collision/)
  const broad = fixture()
  broad.inventoryPrice.table_columns.push('public.customer:id')
  assert.throws(() => targetTopicSpecs(broad), /table_count_invalid/)
})
