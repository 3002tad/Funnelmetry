import test from "node:test"
import assert from "node:assert/strict"
import { createMappingRegistry, createNormalizer } from "../src/index.js"

const receivedAt = "2026-08-29T03:00:00.000Z"
const normalizedAt = "2026-08-29T03:00:01.000Z"

function ingressEvent(overrides = {}) {
  return {
    specversion: "ingress-event.v1",
    source_id: "reference-shop",
    event_id: "browser:evt-1",
    source_event_type: "behavior.product_viewed",
    source_schema_version: "1.0",
    occurred_at: "2026-08-29T02:59:00.000Z",
    producer: "browser_sdk",
    anonymous_id: "anon-1",
    session_id: "session-1",
    source_payload: { product_id: "prod_1" },
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
    source_schema_version: "1.0",
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

test("creates a stable canonical identity across raw redelivery", () => {
  const normalizer = createNormalizer({ now: () => normalizedAt })
  const first = normalizer.normalize(rawInput())
  const second = normalizer.normalize(rawInput())
  assert.equal(first.canonicalEvent.canonical_event_id, second.canonicalEvent.canonical_event_id)
})
