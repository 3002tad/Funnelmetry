// Current Medusa reference offer. Deliberately supports only the Store API
// shapes conformed for this source; never use it to restate order money.
export const STAGE2_TABLES = Object.freeze([
  'product_sales_channel', 'sales_channel', 'sales_channel_stock_location',
  'stock_location', 'product_variant_inventory_item', 'inventory_item',
  'inventory_level', 'reservation_item', 'product_variant_price_set',
  'price_set', 'price', 'price_list', 'price_rule', 'price_list_rule',
  'region', 'currency',
]);

const result = (status, reason, values = {}) => ({ status, reason, ...values });
const active = (rows, table) => (rows[table] ?? []).filter(row => !row.soft_deleted).map(row => row.payload);
const one = values => values.length === 1 ? values[0] : null;
const integer = value => {
  if (value === null || value === undefined || !/^(?:0|[1-9]\d*)$/.test(String(value))) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
};
const money = value => {
  const text = String(value ?? '');
  return /^(?:0|[1-9]\d{0,12})(?:\.\d{1,6})?$/.test(text) ? text : null;
};

export function resolveReferenceOffer({ rows, product, variant, salesChannelId, regionId, currencyCode }) {
  if (!product || !variant || product.soft_deleted || variant.soft_deleted ||
      product.status !== 'published' || variant.product_id !== product.product_id) {
    return { price: result('UNVERIFIED', 'catalog_entity_missing_or_deleted'),
      inventory: result('UNVERIFIED', 'catalog_entity_missing_or_deleted') };
  }
  const price = resolvePrice(rows, variant.variant_id, regionId, currencyCode);
  const inventory = resolveInventory(rows, product, variant, salesChannelId);
  return { price, inventory };
}

function resolvePrice(rows, variantId, regionId, currencyCode) {
  const region = one(active(rows, 'region').filter(row => row.id === regionId));
  const currency = one(active(rows, 'currency').filter(row => row.code === currencyCode));
  if (!region || !currency || region.currency_code !== currencyCode) {
    return result('UNVERIFIED', 'currency_or_region_missing');
  }
  const links = active(rows, 'product_variant_price_set').filter(row => row.variant_id === variantId);
  if (links.length !== 1 || !one(active(rows, 'price_set').filter(row => row.id === links[0].price_set_id))) {
    return result('UNVERIFIED', 'price_set_binding_ambiguous');
  }
  const candidates = active(rows, 'price').filter(row => row.price_set_id === links[0].price_set_id &&
    row.currency_code === currencyCode);
  if (candidates.length !== 1 || candidates[0].price_list_id != null || candidates[0].rules_count !== 0 ||
      candidates[0].min_quantity != null || candidates[0].max_quantity != null ||
      active(rows, 'price_rule').some(row => row.price_id === candidates[0].id)) {
    return result('UNVERIFIED', 'price_list_rule_or_tier_requires_context');
  }
  const amount = money(candidates[0].amount);
  if (amount === null) return result('UNVERIFIED', 'default_price_invalid');
  return result('PASS_SAMPLE_ONLY', 'simple_default_price_conformed', { amount, currency_code: currencyCode });
}

function resolveInventory(rows, product, variant, channelId) {
  const channel = one(active(rows, 'sales_channel').filter(row => row.id === channelId));
  const linked = active(rows, 'product_sales_channel').filter(row =>
    row.product_id === product.product_id && row.sales_channel_id === channelId);
  if (!channel || channel.is_disabled !== false || linked.length !== 1) {
    return result('UNVERIFIED', 'sales_channel_ineligible');
  }
  if (variant.manage_inventory === false) {
    return result('PASS_SAMPLE_ONLY', 'inventory_not_managed', { inventory_quantity: null, purchasable: true });
  }
  if (variant.manage_inventory !== true || variant.allow_backorder !== false) {
    return result('UNVERIFIED', 'inventory_management_or_backorder_not_conformed');
  }
  const links = active(rows, 'product_variant_inventory_item').filter(row => row.variant_id === variant.variant_id);
  if (links.length !== 1 || integer(links[0].required_quantity) !== 1) {
    return result('UNVERIFIED', 'single_item_shape_not_conformed');
  }
  const itemId = links[0].inventory_item_id;
  if (!one(active(rows, 'inventory_item').filter(row => row.id === itemId))) {
    return result('UNVERIFIED', 'inventory_item_missing');
  }
  const locations = active(rows, 'sales_channel_stock_location').filter(row => row.sales_channel_id === channelId);
  if (locations.length !== 1 || !one(active(rows, 'stock_location').filter(row => row.id === locations[0].stock_location_id))) {
    return result('UNVERIFIED', 'single_location_shape_not_conformed');
  }
  const locationId = locations[0].stock_location_id;
  const level = one(active(rows, 'inventory_level').filter(row =>
    row.inventory_item_id === itemId && row.location_id === locationId));
  if (!level) return result('UNVERIFIED', 'inventory_level_missing_or_ambiguous');
  const stocked = integer(level.stocked_quantity), reserved = integer(level.reserved_quantity);
  const reservations = active(rows, 'reservation_item').filter(row =>
    row.inventory_item_id === itemId && row.location_id === locationId).map(row => integer(row.quantity));
  const reservationTotal = reservations.reduce((a, b) => a + b, 0);
  if (stocked === null || reserved === null || reservations.some(value => value === null) ||
      !Number.isSafeInteger(reservationTotal) || reservationTotal !== reserved) {
    return result('UNVERIFIED', 'reservation_or_quantity_not_conformed');
  }
  const quantity = Math.max(0, stocked - reserved);
  return result('PASS_SAMPLE_ONLY', 'single_item_location_conformed',
    { inventory_quantity: quantity, purchasable: quantity > 0 });
}
