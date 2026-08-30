import test from "node:test"
import assert from "node:assert/strict"
import { validateCanonicalEvent, validateCanonicalizationOutcome } from "../src/index.js"

const canonicalEvent = {
  canonical_event_id: "can_1",
  source_event_id: "source:evt-1",
  event_type: "behavior.product_viewed",
  event_class: "BEHAVIOR_INTENT",
  canonical_schema_version: "canonical-event.v1",
  mapping_version: "passthrough-v1",
  occurred_at: "2026-08-29T01:00:00.000Z",
  ingested_at: "2026-08-29T01:00:01.000Z",
  normalized_at: "2026-08-29T01:00:02.000Z",
  source_id: "reference-shop",
  data: { product_id: "prod_1" },
  quality: { time_basis: "source_occurred", authoritative_event_time: true },
  source_reference: { raw_record_id: "ing_1", content_hash: "a".repeat(64), byte_size: 100 },
}

test("validates the canonical analytics boundary", () => {
  assert.equal(validateCanonicalEvent(canonicalEvent).event_type, "behavior.product_viewed")
})

test("rejects a false authoritative-time claim", () => {
  assert.throws(() => validateCanonicalEvent({
    ...canonicalEvent,
    quality: { time_basis: "ingress_fallback", authoritative_event_time: true },
  }), /conflicts/)
})

test("requires every non-normalized outcome to explain why", () => {
  assert.throws(() => validateCanonicalizationOutcome({
    source_id: "reference-shop",
    source_event_id: "source:evt-1",
    status: "unsupported",
    mapping_version: "passthrough-v1",
    processed_at: "2026-08-29T01:00:02.000Z",
    raw_record_id: "ing_1",
  }), /reason_code/)
})

test("rejects non-JSON normalized data before it reaches Kafka", () => {
  assert.throws(() => validateCanonicalEvent({
    ...canonicalEvent,
    data: { amount: 10n },
  }), /JSON-compatible/)
})
