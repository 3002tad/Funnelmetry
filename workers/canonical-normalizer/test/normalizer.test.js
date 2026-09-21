import test from "node:test"
import assert from "node:assert/strict"
import { createMappingRegistry, createNormalizer, loadMappingRegistry } from "../src/index.js"
import { BEHAVIOR_EVENT_DEFINITIONS } from "@3002tad/funnelmetry-behavior-event-catalog"

const receivedAt = "2026-08-29T03:00:00.000Z"
const normalizedAt = "2026-08-29T03:00:01.000Z"

function ingressEvent(overrides = {}) {
  return {
    specversion: "ingress-event.v1",
    source_id: "reference-shop",
    event_id: "browser:evt-1",
    source_event_type: "behavior.product_viewed",
    source_schema_version: "2.0",
    occurred_at: "2026-08-29T02:59:00.000Z",
    producer: "browser_sdk",
    anonymous_id: "anon-1",
    session_id: "session-1",
    source_payload: { product_id: "prod_1", page_instance_id: "page:session-1:product-1" },
    ...overrides,
  }
}

function rawInput(event = ingressEvent(), overrides = {}) {
  return {
    key: Buffer.from(JSON.stringify([event.source_id, event.event_id])),
    value: Buffer.from(JSON.stringify({
      ingestion_id: "ing_1",
      ingestion_attempt_id: "attempt_1",
      received_at: receivedAt,
      raw_body: JSON.stringify(event),
      ...overrides,
    })),
    rawRecordIdFallback: "raw:0:1",
  }
}

test("normalizes a supported raw event with immutable source reference", () => {
  const normalizer = createNormalizer({ now: () => normalizedAt })
  const result = normalizer.normalize(rawInput())

  assert.equal(result.status, "normalized")
  assert.equal(result.canonicalEvent.event_type, "behavior.product_viewed")
  assert.equal(result.canonicalEvent.event_class, "BEHAVIOR_INTENT")
  assert.equal(result.canonicalEvent.quality.time_basis, "source_occurred")
  assert.equal(result.canonicalEvent.quality.authoritative_event_time, true)
  assert.equal(result.canonicalEvent.source_reference.raw_record_id, "ing_1")
  assert.match(result.canonicalEvent.source_reference.content_hash, /^[a-f0-9]{64}$/)
  assert.equal(result.outcome.canonical_event_id, result.canonicalEvent.canonical_event_id)
})

test("uses produced_at and ingress time fallbacks without claiming authoritative time", () => {
  const normalizer = createNormalizer({ now: () => normalizedAt })
  const producedEvent = ingressEvent({ occurred_at: undefined, produced_at: "2026-08-29T02:58:00.000Z" })
  const produced = normalizer.normalize(rawInput(producedEvent))
  assert.equal(produced.canonicalEvent.occurred_at, producedEvent.produced_at)
  assert.equal(produced.canonicalEvent.quality.time_basis, "source_produced")
  assert.equal(produced.canonicalEvent.quality.authoritative_event_time, false)

  const fallbackEvent = ingressEvent({ occurred_at: undefined })
  const fallback = normalizer.normalize(rawInput(fallbackEvent))
  assert.equal(fallback.canonicalEvent.occurred_at, receivedAt)
  assert.equal(fallback.canonicalEvent.quality.time_basis, "ingress_fallback")
})

test("emits an unsupported outcome and quarantine reference for an unknown mapping", () => {
  const normalizer = createNormalizer({ now: () => normalizedAt })
  const result = normalizer.normalize(rawInput(ingressEvent({ source_event_type: "native.unknown" })))

  assert.equal(result.status, "unsupported")
  assert.equal(result.outcome.reason_code, "mapping_not_found")
  assert.equal(result.quarantine.source_reference.raw_record_id, "ing_1")
})

test("quarantines a semantic mapping failure instead of dropping the accepted raw event", () => {
  const registry = createMappingRegistry([{
    source_id: "reference-shop",
    source_event_type: "behavior.product_viewed",
    source_schema_version: "2.0",
    event_type: "behavior.product_viewed",
    event_class: "BEHAVIOR_INTENT",
    mapping_version: "broken-v1",
    map_data() { throw new Error("missing product mapping") },
  }])
  const result = createNormalizer({ registry, now: () => normalizedAt }).normalize(rawInput())

  assert.equal(result.status, "quarantined")
  assert.equal(result.outcome.reason_code, "mapping_failed")
  assert.match(result.quarantine.detail, /missing product mapping/)
})

test("quarantines a known browser event whose payload violates the behavior catalog", () => {
  const result = createNormalizer({ now: () => normalizedAt }).normalize(rawInput(ingressEvent({
    source_event_type: "behavior.scroll_depth_reached",
    source_payload: { page_type: "product", page_instance_id: "page:session-1:product-1", depth_percent: 40 },
  })))

  assert.equal(result.status, "quarantined")
  assert.equal(result.outcome.reason_code, "mapping_failed")
  assert.match(result.quarantine.detail, /depth_percent/)
})

test("maps every behavior catalog event to its approved authority class", () => {
  const payloads = {
    "behavior.page_viewed": { page_type: "home", path_template: "/{countryCode}", page_instance_id: "page:session-1:home-1" },
    "behavior.scroll_depth_reached": { page_type: "home", page_instance_id: "page:session-1:home-1", depth_percent: 25 },
    "promotion.banner_impression": { banner_id: "hero_1", placement_id: "homepage_hero", page_instance_id: "page:session-1:home-1", visible_percent: 50, visible_ms: 1000 },
    "promotion.banner_clicked": { banner_id: "hero_1", placement_id: "homepage_hero", page_instance_id: "page:session-1:home-1" },
    "behavior.search_submitted": { search_interaction_id: "search:interaction-1", query_normalized: "running shoes", outcome: "succeeded", result_count: 5 },
    "behavior.filter_applied": { page_instance_id: "page:session-1:home-1", filter_keys: ["category"], active_filter_count: 1 },
    "behavior.product_viewed": { product_id: "prod_1", page_instance_id: "page:session-1:product-1" },
    "checkout.started": { cart_id: "cart_1", step: "address", page_instance_id: "page:session-1:checkout-1" },
  }
  const normalizer = createNormalizer({ now: () => normalizedAt })

  for (const [eventType, definition] of Object.entries(BEHAVIOR_EVENT_DEFINITIONS)) {
    const result = normalizer.normalize(rawInput(ingressEvent({
      source_event_type: eventType,
      producer: definition.producer === 'source_server' ? 'source_bridge' : 'browser_sdk',
      source_payload: payloads[eventType],
    })))
    assert.equal(result.status, "normalized", eventType)
    assert.equal(result.canonicalEvent.event_type, eventType)
    assert.equal(result.canonicalEvent.event_class, definition.event_class)
  }
})

test("creates a stable canonical identity across raw redelivery", () => {
  const normalizer = createNormalizer({ now: () => normalizedAt })
  const first = normalizer.normalize(rawInput())
  const second = normalizer.normalize(rawInput())
  assert.equal(first.canonicalEvent.canonical_event_id, second.canonicalEvent.canonical_event_id)
})

test('V2-only behavior rejects legacy and unknown schemas without guessing payload version', () => {
  for (const version of ['1.0', '3.0']) {
    const result = createNormalizer().normalize(rawInput(ingressEvent({ source_schema_version: version })))
    assert.equal(result.status, 'unsupported')
    assert.equal(result.outcome.reason_code, 'mapping_not_found')
  }
  const result = createNormalizer().normalize(rawInput(ingressEvent({ source_event_type: 'cart.add_clicked' })))
  assert.equal(result.status, 'unsupported')
})

test('V2 search requires server producer, new payload and distinct mapping identity', () => {
  const event = ingressEvent({ source_event_type: 'behavior.search_submitted', producer: 'source_bridge',
    source_payload: { search_interaction_id: 'search:1', query_normalized: 'shoes', outcome: 'succeeded', result_count: 2 } })
  const normalizer = createNormalizer()
  const valid = normalizer.normalize(rawInput(event))
  assert.equal(valid.status, 'normalized')
  assert.equal(valid.canonicalEvent.mapping_version, 'canonical-behavior-v2')
  assert.equal(normalizer.normalize(rawInput({ ...event, producer: 'browser_sdk' })).status, 'quarantined')
  assert.equal(normalizer.normalize(rawInput({ ...event, source_payload: { page_instance_id: 'page:1', query_length_bucket: '3-5' } })).status, 'quarantined')
  assert.equal(normalizer.normalize(rawInput({ ...event, source_payload: { ...event.source_payload, query_normalized: 'user@example.com' } })).status, 'quarantined')
})

test('deployed Medusa schema 1 browser uses v2 validation without restoring v1 catalog', () => {
  const normalizer = createNormalizer()
  const event = ingressEvent({ source_id: 'medusa-reference', source_schema_version: '1.0' })
  const result = normalizer.normalize(rawInput(event))
  assert.equal(result.status, 'normalized')
  assert.equal(result.canonicalEvent.mapping_version, 'medusa-browser-schema1-catalog-v2')
  assert.equal(normalizer.normalize(rawInput({ ...event, source_payload: { product_id: 'p1' } })).status, 'quarantined')
  assert.equal(normalizer.normalize(rawInput({ ...event, producer: 'source_bridge' })).status, 'quarantined')
  for (const type of ['cart.add_clicked', 'behavior.search_submitted']) {
    assert.equal(normalizer.normalize(rawInput({ ...event, source_event_type: type })).status, 'unsupported')
  }
  assert.equal(normalizer.normalize(rawInput({ ...event, source_id: 'other-shop' })).status, 'unsupported')
})

test("loads the Medusa source-native order mapping without weakening canonical semantics", async () => {
  const mappingPath = new URL("../../../integrations/medusa/canonical-mappings.v1.json", import.meta.url)
  const registry = await loadMappingRegistry(mappingPath)
  const normalizer = createNormalizer({ registry, now: () => normalizedAt })
  const result = normalizer.normalize(rawInput(ingressEvent({
    source_id: "medusa-reference",
    event_id: "medusa:order.placed:order_1",
    source_event_type: "medusa.order_placed",
    source_schema_version: '1.0',
    producer: "source_bridge",
    aggregate: { type: "order", id: "order_1" },
    source_payload: { order_id: "order_1", currency_code: "usd", total_minor: 1200 },
  })))

  assert.equal(result.status, "normalized")
  assert.equal(result.canonicalEvent.event_type, "order.created")
  assert.equal(result.canonicalEvent.event_class, "BUSINESS_FACT")
  assert.equal(result.canonicalEvent.mapping_version, "medusa-v2-order-placed-v1")
  assert.equal(result.canonicalEvent.data.order_id, "order_1")
})

test("does not apply the Medusa native mapping to another source", async () => {
  const mappingPath = new URL("../../../integrations/medusa/canonical-mappings.v1.json", import.meta.url)
  const registry = await loadMappingRegistry(mappingPath)
  const result = createNormalizer({ registry, now: () => normalizedAt }).normalize(rawInput(ingressEvent({
    source_event_type: "medusa.order_placed",
    producer: "source_bridge",
  })))

  assert.equal(result.status, "unsupported")
  assert.equal(result.outcome.reason_code, "mapping_not_found")
})
