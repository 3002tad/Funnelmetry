// Explicit DA projection, never expose the arbitrary canonical payload.
export function eventBusinessDetails(eventType, input) {
  const data = input && typeof input === 'object' && !Array.isArray(input) ? input : {}
  const details = {}
  const idFields = ['product_id', 'variant_id', 'cart_id', 'order_id', 'line_item_id']
  const supported = ['behavior.product_viewed', 'cart.item_added', 'checkout.started', 'order.created', 'order.placed', 'order.accepted']
  if (!supported.includes(eventType)) return null
  function copy(source, target) {
    for (const key of idFields) {
      if (typeof source[key] === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(source[key])) target[key] = source[key]
    }
    for (const key of ['quantity', 'unit_price_minor', 'total_minor']) {
      if (Number.isSafeInteger(source[key]) && source[key] >= 0) target[key] = source[key]
    }
  }
  copy(data, details)
  const major = data.amount_unit === 'major' && data.amount_semantics === 'medusa.order.total'
  const decimal = value => typeof value === 'string' && value.length <= 64 && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)
  if (major) {
    details.amount_unit = 'major'
    details.amount_semantics = 'medusa.order.total'
    if (decimal(data.total_amount)) details.total_amount = data.total_amount
  }
  if (typeof data.currency_code === 'string' && /^[a-zA-Z]{3}$/.test(data.currency_code)) details.currency_code = data.currency_code.toUpperCase()
  if (Array.isArray(data.items)) {
    details.items = data.items.slice(0, 50).map(item => {
      const safe = {}
      if (item && typeof item === 'object' && !Array.isArray(item)) copy(item, safe)
      if (major && decimal(item?.unit_price_amount)) safe.unit_price_amount = item.unit_price_amount
      return safe
    })
    details.items_truncated = data.items.length > 50
  }
  return details
}
