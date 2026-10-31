import assert from 'node:assert/strict'
import test from 'node:test'
import { addedQuantity, canonicalCartAdded, decodeCartChange } from '../src/projection.js'

const prefix = 'cdc_medusa_cart_v1'
const topic = `${prefix}.public.cart_line_item`
const row = quantity => ({ id: 'cali_1', cart_id: 'cart_1', product_id: 'prod_1',
  variant_id: 'variant_1', quantity, created_at: '2026-10-31T01:00:00Z',
  updated_at: '2026-10-31T01:01:00Z', deleted_at: null })
const message = (op, quantity, snapshot = false) => ({ op, after: row(quantity),
  source: { name: prefix, db: 'medusa', schema: 'public', table: 'cart_line_item',
    snapshot: snapshot ? 'true' : 'false', lsn: 123, ts_ms: 1793408460000 } })
const decode = value => decodeCartChange({ key: { id: 'cali_1' }, value, prefix, topic, partition: 0 })

test('initial snapshot seeds state without inventing add-to-cart events', () => {
  const snapshot = decode(message('r', 3, true))
  assert.equal(addedQuantity(null, snapshot), 0)
  assert.equal(addedQuantity({ cart_id: 'cart_1', variant_id: 'variant_1', quantity: 3,
    deleted: false }, decode(message('u', 2))), 0)
})

test('insert and positive quantity delta produce only the newly added quantity', () => {
  assert.equal(addedQuantity(null, decode(message('c', 2))), 2)
  const previous = { cart_id: 'cart_1', variant_id: 'variant_1', quantity: 2, deleted: false }
  const change = decode(message('u', 5))
  assert.equal(addedQuantity(previous, change), 3)
  const event = canonicalCartAdded({ sourceId: 'medusa-reference', epochId: 'cart-e1',
    topic, partition: 0, offset: '42', rawValue: message('u', 5), change,
    quantity: 3, now: '2026-10-31T01:02:00Z' })
  assert.equal(event.event_type, 'cart.item_added')
  assert.equal(event.event_class, 'BUSINESS_FACT')
  assert.equal(event.data.quantity, 3)
  assert.equal(event.relations.correlation_id, 'cart:cart_1')
  assert.equal(event.quality.authoritative_event_time, false)
})

test('out-of-baseline update and changed line identity fail closed', () => {
  assert.throws(() => addedQuantity(null, decode(message('u', 4))), /without_baseline/)
  assert.throws(() => addedQuantity({ cart_id: 'cart_other', variant_id: 'variant_1',
    quantity: 1, deleted: false }, decode(message('u', 4))), /identity_changed/)
})
