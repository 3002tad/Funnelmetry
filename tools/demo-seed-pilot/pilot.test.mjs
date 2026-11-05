import test from 'node:test'
import assert from 'node:assert/strict'
import { validateBehaviorEvent } from '../../packages/behavior-event-catalog/src/index.js'
import { validateCanonicalEvent } from '../../packages/canonical-contract/src/index.js'
import { CONFIG, canonicalFor, generate, logicalHash, summarize } from './generator.mjs'

test('pilot is deterministic and uses real browser and CDC contract validators', () => {
  const fixture = generate()
  assert.equal(logicalHash(fixture), logicalHash(generate()))
  assert.notEqual(logicalHash(fixture), logicalHash(generate({ ...CONFIG, seed: CONFIG.seed + 1 })))
  const products = new Set(fixture.products.map(p => p.product_id)), variants = new Set(fixture.products.map(p => p.variant_id))
  const carts = new Set(fixture.carts.map(c => c.cart_id))
  const ids = new Set()
  for (const event of fixture.events) {
    assert(!ids.has(event.event_id)); ids.add(event.event_id)
    if (!event.cdc) validateBehaviorEvent(event.event_type, event.data)
    const canonical = validateCanonicalEvent(canonicalFor(event, fixture.config, '2026-11-05T00:00:00.000Z'))
    if (event.cdc) { assert.equal(canonical.quality.time_basis, 'source_produced'); assert.equal(canonical.quality.authoritative_event_time, false) }
    if (event.data.product_id) assert(products.has(event.data.product_id))
    if (event.data.variant_id) assert(variants.has(event.data.variant_id))
    if (event.data.cart_id) assert(carts.has(event.data.cart_id))
    assert(Date.parse(event.occurred_at) < Date.parse('2026-11-05T00:00:00.000Z'))
  }
  for (const order of fixture.orders) assert(carts.has(order.cart_id))
  assert.equal(summarize(fixture).event_types['cart.item_added'], fixture.carts.length)
  assert(!fixture.events.some(e => ['medusa.order_placed', 'order.placed', 'behavior.search_submitted'].includes(e.event_type)))
})

test('rejects unbounded or invalid pilot configuration', () => {
  assert.throws(() => generate({ ...CONFIG, sessions: 5001 }))
  assert.throws(() => generate({ ...CONFIG, end: CONFIG.start }))
})
