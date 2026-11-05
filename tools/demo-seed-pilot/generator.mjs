import { createHash } from 'node:crypto'
import { validateBehaviorEvent } from '../../packages/behavior-event-catalog/src/index.js'
import { canonicalCartAdded, decodeCartChange, addedQuantity } from '../../workers/cart-line-item-cdc-mapper/src/projection.js'

export const CONFIG = Object.freeze({ dataset_id: 'demo-seed-pilot-v1', source_id: 'demo-reference-pilot', epoch: 'demo-epoch-v1', seed: 20261104, sessions: 120, products: 30, start: '2025-11-01T00:00:00.000Z', end: '2026-11-01T00:00:00.000Z' })
const digest = value => createHash('sha256').update(value).digest('hex')
const id = (kind, n) => `demo-${kind}-${String(n).padStart(5, '0')}`
function prng(seed) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 } }

// This is a synthetic logical fixture, not a historical CDC capture or an input feed.
export function generate(config = CONFIG) {
  if (!Number.isSafeInteger(config.seed) || !Number.isSafeInteger(config.sessions) || config.sessions < 1 || config.sessions > 5000 || !Number.isSafeInteger(config.products) || config.products < 1 || config.products > 1000) throw Error('invalid bounded pilot configuration')
  const start = Date.parse(config.start), end = Date.parse(config.end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start < config.sessions * 600000) throw Error('invalid date range')
  const random = prng(config.seed), categories = ['Home', 'Sports', 'Beauty', 'Accessories'].map((name, i) => ({ category_id: id('category', i), name }))
  const products = Array.from({ length: config.products }, (_, i) => ({ product_id: id('product', i), variant_id: id('variant', i), title: `Synthetic product ${i + 1}`, category_id: i % 13 === 0 ? null : categories[i % categories.length].category_id }))
  const events = [], carts = [], orders = []
  const add = (session, type, time, data, options = {}) => {
    const definition = options.cart ? null : validateBehaviorEvent(type, data)
    events.push({ event_id: id('event', events.length), session_id: session, event_type: type, event_class: definition?.event_class ?? 'BUSINESS_FACT', occurred_at: new Date(time).toISOString(), data, utm_source: options.utm ?? null, producer: options.cart ? 'synthetic_cdc' : 'synthetic_browser', ...(options.cart ? { cdc: options.cart } : {}) })
  }
  for (let i = 0; i < config.sessions; i++) {
    const session = id('session', i), page = `page:${session}`, product = products[Math.floor(Math.pow(random(), 2) * products.length)]
    const time = start + Math.floor((end - start - 600000) * i / config.sessions) + Math.floor(random() * 300000)
    const utm = ['organic', 'newsletter', 'social', null][Math.floor(random() * 4)]
    add(session, 'behavior.page_viewed', time, { page_type: 'product', path_template: '/{countryCode}/products/{handle}', page_instance_id: page }, { utm })
    add(session, 'behavior.product_viewed', time + 1000, { product_id: product.product_id, variant_id: product.variant_id, page_instance_id: page }, { utm })
    if (random() < 0.45) add(session, 'behavior.scroll_depth_reached', time + 2000, { page_type: 'product', page_instance_id: page, depth_percent: [25, 50, 75, 100][Math.floor(random() * 4)] }, { utm })
    if (random() < 0.25) add(session, 'behavior.search_query_submitted', time + 3000, { search_interaction_id: `search:${session}`, query_normalized: ['travel bag', 'water bottle', 'running shoes'][Math.floor(random() * 3)], page_instance_id: page }, { utm })
    if (random() < 0.35) {
      const cart = id('cart', carts.length), line = id('line', carts.length), offset = carts.length, ts = time + 4000
      const row = { id: line, cart_id: cart, product_id: product.product_id, variant_id: product.variant_id, quantity: 1, created_at: ts, updated_at: ts, deleted_at: null }
      const prefix = 'demo_cart', topic = `${prefix}.public.cart_line_item`, raw = { op: 'c', after: row, source: { name: prefix, db: 'medusa', schema: 'public', table: 'cart_line_item', snapshot: false, lsn: offset + 1, ts_ms: ts } }
      const change = decodeCartChange({ key: { id: line }, value: raw, prefix, topic, partition: 0 })
      const quantity = addedQuantity(null, change)
      carts.push({ cart_id: cart, line_item_id: line, product_id: product.product_id, variant_id: product.variant_id, quantity, updated_at: new Date(ts).toISOString() })
      add(session, 'cart.item_added', ts, { cart_id: cart, line_item_id: line, product_id: product.product_id, variant_id: product.variant_id, quantity, coverage_epoch_id: config.epoch }, { cart: { topic, offset, raw } })
      add(session, 'context.cart_linked', ts + 1000, { cart_id: cart, page_instance_id: page }, { utm })
      if (random() < 0.55) {
        add(session, 'checkout.started', ts + 2000, { cart_id: cart, step: 'address', page_instance_id: page }, { utm })
        if (random() < 0.7) orders.push({ order_id: id('order', orders.length), cart_id: cart, active: random() >= 0.1 })
      }
    }
  }
  return { config, categories, products, events, carts, orders }
}

export function browserEnvelope(event, config) {
  return { specversion: 'ingress-event.v1', source_id: config.source_id, event_id: `demo:${event.event_id}`, producer: 'browser_sdk', source_event_type: event.event_type, source_schema_version: '2.0', occurred_at: event.occurred_at, source_payload: event.data, source_metadata: { synthetic: true, ...(event.utm_source === null ? {} : { utm_source: event.utm_source }) } }
}

export function canonicalFor(event, config, ingestedAt) {
  if (event.cdc) {
    const { topic, offset, raw } = event.cdc
    const change = decodeCartChange({ key: { id: raw.after.id }, value: raw, prefix: 'demo_cart', topic, partition: 0 })
    return canonicalCartAdded({ sourceId: config.source_id, epochId: config.epoch, topic, partition: 0, offset, rawValue: raw, change, quantity: addedQuantity(null, change), now: ingestedAt })
  }
  const raw = JSON.stringify(browserEnvelope(event, config))
  return { canonical_event_id: event.event_id, source_event_id: `demo:${event.event_id}`, source_id: config.source_id, event_type: event.event_type, event_class: event.event_class, canonical_schema_version: 'canonical-event.v1', mapping_version: 'synthetic-demo-v1', occurred_at: event.occurred_at, ingested_at: ingestedAt, normalized_at: ingestedAt, data: event.data, identity: { session_id: event.session_id }, quality: { time_basis: 'source_occurred', authoritative_event_time: true, synthetic: true }, source_reference: { raw_record_id: `demo:${event.event_id}`, content_hash: digest(raw), byte_size: Buffer.byteLength(raw) } }
}

export function summarize(data) {
  const types = {}
  for (const event of data.events) types[event.event_type] = (types[event.event_type] ?? 0) + 1
  return { categories: data.categories.length, products: data.products.length, sessions: data.config.sessions, events: data.events.length, event_types: types, cart_lines: data.carts.length, recorded_orders: data.orders.length, active_recorded_orders: data.orders.filter(x => x.active).length }
}

export function logicalHash(data) { return digest(JSON.stringify(data)) }
