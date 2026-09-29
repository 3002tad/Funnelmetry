// Validated source contract, not a price conversion or a payment assertion.
export function validateMedusaOrder(event) {
  const data = event.source_payload
  const id = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value)
  const amount = value => typeof value === 'string' && /^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value) && value.length <= 64
  if (event.producer !== 'source_bridge' || !event.occurred_at
    || !id(data.order_id) || !id(data.cart_id)
    || event.aggregate?.type !== 'order' || event.aggregate.id !== data.order_id
    || event.correlation_id !== `cart:${data.cart_id}`
    || !amount(data.total_amount) || !/^[a-zA-Z]{3}$/.test(data.currency_code ?? '')
    || data.amount_unit !== 'major' || data.amount_semantics !== 'medusa.order.total'
    || Object.hasOwn(data, 'total_minor') || !Array.isArray(data.items)) {
    throw Error('Invalid Medusa order-placement schema 2.0 authority, identity or money contract')
  }
  for (const item of data.items) {
    if (!item || !id(item.product_id) || !id(item.variant_id)
      || !Number.isSafeInteger(item.quantity) || item.quantity <= 0
      || !amount(item.unit_price_amount) || Object.hasOwn(item, 'unit_price_minor')) {
      throw Error('Invalid Medusa order item major-unit contract')
    }
  }
  return data // Preserve exact decimal strings and source payload; never divide by 100.
}
