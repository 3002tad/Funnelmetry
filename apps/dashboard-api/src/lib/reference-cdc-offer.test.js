import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveReferenceOffer, STAGE2_TABLES } from './reference-cdc-offer.js';

const row = payload => ({ payload, soft_deleted: false });
const context = () => ({ ...Object.fromEntries(STAGE2_TABLES.map(table => [table, []])),
  product_sales_channel: [row({ product_id: 'prod_1', sales_channel_id: 'sc_1' })],
  sales_channel: [row({ id: 'sc_1', is_disabled: false })],
  sales_channel_stock_location: [row({ sales_channel_id: 'sc_1', stock_location_id: 'loc_1' })],
  stock_location: [row({ id: 'loc_1' })],
  product_variant_inventory_item: [row({ variant_id: 'var_1', inventory_item_id: 'item_1', required_quantity: '1' })],
  inventory_item: [row({ id: 'item_1' })],
  inventory_level: [row({ inventory_item_id: 'item_1', location_id: 'loc_1', stocked_quantity: '10', reserved_quantity: '2' })],
  reservation_item: [row({ inventory_item_id: 'item_1', location_id: 'loc_1', quantity: '2' })],
  product_variant_price_set: [row({ variant_id: 'var_1', price_set_id: 'ps_1' })],
  price_set: [row({ id: 'ps_1' })],
  price: [row({ id: 'price_1', price_set_id: 'ps_1', currency_code: 'eur', amount: '15.5',
    price_list_id: null, rules_count: 0, min_quantity: null, max_quantity: null })],
  region: [row({ id: 'reg_1', currency_code: 'eur' })],
  currency: [row({ code: 'eur', decimal_digits: 2 })],
});
const args = () => ({ rows: context(), product: { product_id: 'prod_1', status: 'published', soft_deleted: false },
  variant: { variant_id: 'var_1', product_id: 'prod_1', manage_inventory: true,
    allow_backorder: false, soft_deleted: false }, salesChannelId: 'sc_1', regionId: 'reg_1', currencyCode: 'eur' });

test('conformed current price and reserved stock keep independent grains', () => {
  const offer = resolveReferenceOffer(args());
  assert.deepEqual([offer.price.status, offer.price.amount, offer.price.currency_code],
    ['PASS_SAMPLE_ONLY', '15.5', 'eur']);
  assert.deepEqual([offer.inventory.status, offer.inventory.inventory_quantity], ['PASS_SAMPLE_ONLY', 8]);
});

test('price list and reservation drift fail closed without affecting the other answer', () => {
  const input = args();
  input.rows.price[0].payload.price_list_id = 'list_1';
  input.rows.reservation_item[0].payload.quantity = '3';
  const offer = resolveReferenceOffer(input);
  assert.equal(offer.price.status, 'UNVERIFIED');
  assert.equal(offer.inventory.status, 'UNVERIFIED');
  assert.equal(offer.price.amount, undefined);
  assert.equal(offer.inventory.inventory_quantity, undefined);
});

test('unmanaged stock and missing catalog identity are explicit', () => {
  const input = args();
  input.variant.manage_inventory = false;
  assert.equal(resolveReferenceOffer(input).inventory.inventory_quantity, null);
  input.variant.product_id = 'other';
  const offer = resolveReferenceOffer(input);
  assert.equal(offer.price.status, 'UNVERIFIED');
  assert.equal(offer.inventory.status, 'UNVERIFIED');
});
