import test from 'node:test'
import assert from 'node:assert/strict'
import { eventBusinessDetails } from '../src/lib/event-business-details.js'

test('placement major-unit amounts remain decimal strings and never become minor units', () => {
  const result = eventBusinessDetails('order.placed', { order_id: 'order_1', total_amount: '20.00', amount_unit: 'major', amount_semantics: 'medusa.order.total', currency_code: 'eur', email: 'private', items: [{ product_id: 'prod_1', unit_price_amount: '10.00' }] })
  assert.equal(result.total_amount, '20.00')
  assert.equal(result.items[0].unit_price_amount, '10.00')
  assert.equal(result.currency_code, 'EUR')
  assert.equal(result.total_minor, undefined)
  assert.equal(result.email, undefined)
})

test('business details exclude arbitrary nested payload and unsafe values', () => {
  assert.equal(eventBusinessDetails('behavior.search_submitted', { query_normalized: 'private' }), null)
  const result = eventBusinessDetails('order.created', { order_id: 'order_1', email: 'secret', total_minor: 0, currency_code: 'usd', items: [{ product_id: 'prod_1', name: 'private', address: {}, quantity: -1, unit_price_minor: Number.MAX_SAFE_INTEGER + 1 }] })
  assert.deepEqual(result, { order_id: 'order_1', total_minor: 0, currency_code: 'USD', items: [{ product_id: 'prod_1' }], items_truncated: false })
})
test('missing values stay missing and large item arrays are visibly truncated', () => {
  assert.deepEqual(eventBusinessDetails('cart.item_added', null), {})
  const result = eventBusinessDetails('order.created', { items: Array.from({ length: 51 }, () => ({ quantity: 1 })) })
  assert.equal(result.items.length, 50)
  assert.equal(result.items_truncated, true)
})
