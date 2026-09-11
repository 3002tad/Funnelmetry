import assert from "node:assert/strict"
import test from "node:test"
import {
  INGRESS_EVENT_SPEC_VERSION,
  RELAY_RECEIPT_SPEC_VERSION,
  validateIngressEvent,
  validateIngressReceipt,
  validateRelayReceipt,
} from "../src/index.js"

const event = {
  specversion: INGRESS_EVENT_SPEC_VERSION,
  source_id: "medusa-reference",
  event_id: "browser:evt-123",
  source_event_type: "behavior.product_viewed",
  source_schema_version: "1.0",
  occurred_at: "2026-08-22T09:00:00.000Z",
  producer: "browser_sdk",
  source_payload: { product_id: "prod_1" },
}

test("validates the raw ingress envelope without changing source timestamps", () => {
  const actual = validateIngressEvent(event)
  assert.equal(actual.event_id, "browser:evt-123")
  assert.equal(actual.occurred_at, event.occurred_at)
})

test("rejects browser payload fields that can contain direct PII or payment data", () => {
  assert.throws(() => validateIngressEvent({ ...event, source_payload: { email: "user@example.test" } }), /sensitive field/)
})

test("rejects a producer outside the approved input-only boundary", () => {
  assert.throws(() => validateIngressEvent({ ...event, producer: "unknown_client" }), /producer is unsupported/)
})

test("requires a durable record identity for accepted and duplicate receipts", () => {
  assert.throws(() => validateIngressReceipt({ status: "accepted", source_id: event.source_id, event_id: event.event_id, received_at: event.occurred_at }), /ingestion_id/)
  assert.equal(validateIngressReceipt({ status: "duplicate", source_id: event.source_id, event_id: event.event_id, received_at: event.occurred_at, ingestion_id: "ing_1" }).status, "duplicate")
})

test("validates a Relay receipt without treating it as an Ingress receipt", () => {
  const receipt = validateRelayReceipt({
    specversion: RELAY_RECEIPT_SPEC_VERSION,
    status: "relay_queued",
    relay_id: "rel_123",
    source_id: event.source_id,
    event_id: event.event_id,
    relay_received_at: event.occurred_at,
  })
  assert.equal(receipt.status, "relay_queued")
  assert.throws(() => validateIngressReceipt(receipt), /receipt.status is unsupported/)
})
