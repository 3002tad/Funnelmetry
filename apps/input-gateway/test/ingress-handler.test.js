import assert from "node:assert/strict"
import test from "node:test"
import { createIngressHandler } from "../src/index.js"

const receivedAt = "2026-08-27T03:00:00.000Z"
const baseEvent = {
  specversion: "ingress-event.v1", source_id: "medusa-reference",
  event_id: "browser:evt-123", source_event_type: "behavior.product_viewed",
  source_schema_version: "2.0", occurred_at: "2026-08-27T02:59:58.000Z",
  producer: "browser_sdk", anonymous_id: "anon-1", session_id: "session-1",
  source_payload: { product_id: "prod_1", page_instance_id: "page:product-1" },
}

function createDurableFake() {
  const receipts = new Map(), calls = []
  return {
    calls,
    async accept(event, context) {
      calls.push({ event, context })
      const key = `${event.source_id}:${event.event_id}`
      const existing = receipts.get(key)
      if (existing) return { ...existing, status: "duplicate", received_at: context.received_at }
      const receipt = {
        status: "accepted", source_id: event.source_id, event_id: event.event_id,
        ingestion_id: `ing_${receipts.size + 1}`,
        ingestion_attempt_id: context.ingestion_attempt_id, received_at: context.received_at,
      }
      receipts.set(key, receipt)
      return receipt
    },
  }
}

function createHandler(durableIngress, overrides = {}) {
  return createIngressHandler({
    durableIngress,
    browserKeys: {
      "medusa-browser-dev": { source_id: "medusa-reference", secret: "browser-secret" },
    },
    now: () => receivedAt, createAttemptId: () => "attempt-browser-1", ...overrides,
  })
}
const browserRequest = (event = baseEvent, key = "medusa-browser-dev", secret = "browser-secret") => ({
  headers: { "x-funnelmetry-source-key-id": key, "x-funnelmetry-write-key": secret },
  body: JSON.stringify(event),
})

test("accepts Browser SDK only after a durable receipt and deduplicates stable identity", async () => {
  const durable = createDurableFake(), handle = createHandler(durable)
  const accepted = await handle(browserRequest())
  assert.equal(accepted.httpStatus, 202)
  assert.equal(accepted.body.ingestion_id, "ing_1")
  assert.equal(durable.calls[0].context.auth.method, "browser_write_key")
  const duplicate = await handle(browserRequest())
  assert.equal(duplicate.httpStatus, 200)
  assert.equal(duplicate.body.ingestion_id, accepted.body.ingestion_id)
})

test("rejects every non-browser producer before durable handoff", async () => {
  const durable = createDurableFake(), handle = createHandler(durable)
  const result = await handle(browserRequest({ ...baseEvent, producer: "source_bridge" }))
  assert.equal(result.httpStatus, 401)
  assert.equal(result.body.reason_code, "producer_auth_unsupported")
  assert.equal(durable.calls.length, 0)
})

test("rejects unknown, wrong-source and invalid Browser SDK credentials", async () => {
  const durable = createDurableFake(), handle = createHandler(durable, {
    browserKeys: {
      browser: { source_id: "medusa-reference", secret: "browser-secret" },
      other: { source_id: "another-source", secret: "browser-secret" },
    },
  })
  for (const [request, reason] of [
    [browserRequest(baseEvent, "unknown"), "source_key_unknown"],
    [browserRequest(baseEvent, "other"), "source_key_mismatch"],
    [browserRequest(baseEvent, "browser", "wrong"), "write_key_invalid"],
  ]) {
    const result = await handle(request)
    assert.equal(result.httpStatus, 401)
    assert.equal(result.body.reason_code, reason)
  }
  assert.equal(durable.calls.length, 0)
})

test("returns retryable failure without inventing a durable receipt", async () => {
  const handle = createHandler({ async accept() { throw new Error("broker unavailable") } })
  const result = await handle(browserRequest())
  assert.equal(result.httpStatus, 503)
  assert.equal(result.body.status, "retryable_failure")
  assert.equal(result.body.reason_code, "durable_handoff_failed")
  assert.equal(result.body.ingestion_id, undefined)
})

test("accepts missing occurred_at for downstream quality fallback", async () => {
  const durable = createDurableFake(), handle = createHandler(durable)
  const { occurred_at: _ignored, ...withoutOccurredAt } = baseEvent
  const result = await handle(browserRequest(withoutOccurredAt))
  assert.equal(result.httpStatus, 202)
  assert.equal(durable.calls[0].event.occurred_at, undefined)
})
