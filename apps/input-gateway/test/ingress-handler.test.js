import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import test from "node:test"
import { createIngressHandler } from "../src/index.js"

const receivedAt = "2026-08-27T03:00:00.000Z"
const baseEvent = {
  specversion: "ingress-event.v1",
  source_id: "medusa-reference",
  event_id: "browser:evt-123",
  source_event_type: "commerce.product.viewed",
  source_schema_version: "1.0",
  occurred_at: "2026-08-27T02:59:58.000Z",
  producer: "browser_sdk",
  anonymous_id: "anon-1",
  session_id: "session-1",
  source_payload: { product_id: "prod_1" },
}

function createDurableFake() {
  const receipts = new Map()
  const calls = []
  return {
    calls,
    async accept(event, context) {
      calls.push({ event, context })
      const key = `${event.source_id}:${event.event_id}`
      const existing = receipts.get(key)
      if (existing) return { ...existing, status: "duplicate", received_at: context.received_at }
      const receipt = {
        status: "accepted",
        source_id: event.source_id,
        event_id: event.event_id,
        ingestion_id: `ing_${receipts.size + 1}`,
        ingestion_attempt_id: context.ingestion_attempt_id,
        received_at: context.received_at,
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
    backendKeys: {
      "medusa-backend-dev": { source_id: "medusa-reference", secret: "backend-secret" },
    },
    now: () => receivedAt,
    nowMs: () => Date.parse(receivedAt),
    createAttemptId: () => "attempt-browser-1",
    ...overrides,
  })
}

test("returns accepted only after the durable adapter returns a durable receipt", async () => {
  const durable = createDurableFake()
  const handle = createHandler(durable)
  const result = await handle({
    headers: {
      "x-funnelmetry-source-key-id": "medusa-browser-dev",
      "x-funnelmetry-write-key": "browser-secret",
    },
    body: JSON.stringify(baseEvent),
  })

  assert.equal(result.httpStatus, 202)
  assert.equal(result.body.status, "accepted")
  assert.equal(result.body.ingestion_id, "ing_1")
  assert.equal(durable.calls.length, 1)
  assert.equal(durable.calls[0].event.occurred_at, baseEvent.occurred_at)
  assert.deepEqual(durable.calls[0].event.source_payload, baseEvent.source_payload)
})

test("returns the original ingestion identity for a duplicate stable event", async () => {
  const durable = createDurableFake()
  const handle = createHandler(durable)
  const request = {
    headers: {
      "x-funnelmetry-source-key-id": "medusa-browser-dev",
      "x-funnelmetry-write-key": "browser-secret",
    },
    body: JSON.stringify(baseEvent),
  }

  const accepted = await handle(request)
  const duplicate = await handle(request)
  assert.equal(duplicate.httpStatus, 200)
  assert.equal(duplicate.body.status, "duplicate")
  assert.equal(duplicate.body.ingestion_id, accepted.body.ingestion_id)
})

test("accepts an exact-body HMAC request from a source bridge", async () => {
  const durable = createDurableFake()
  const handle = createHandler(durable)
  const timestamp = "2026-08-27T03:00:00.000Z"
  const event = {
    ...baseEvent,
    event_id: "medusa:order-123:placed:v1",
    source_event_type: "order.placed",
    producer: "source_bridge",
    aggregate: { type: "order", id: "order_123", version: "1" },
    source_payload: { order_id: "order_123", total: 12500, currency_code: "vnd" },
  }
  const body = JSON.stringify(event)
  const signature = createHmac("sha256", "backend-secret").update(`${timestamp}.${body}`).digest("hex")
  const result = await handle({
    headers: {
      "x-funnelmetry-source-key-id": "medusa-backend-dev",
      "x-funnelmetry-timestamp": timestamp,
      "x-funnelmetry-signature": signature,
      "x-funnelmetry-request-id": "request-bridge-1",
    },
    body,
  })

  assert.equal(result.httpStatus, 202)
  assert.equal(result.body.status, "accepted")
  assert.equal(durable.calls[0].context.auth.method, "hmac_sha256")
  assert.equal(durable.calls[0].context.ingestion_attempt_id, "request-bridge-1")
})

test("rejects an invalid bridge signature before durable handoff", async () => {
  const durable = createDurableFake()
  const handle = createHandler(durable)
  const event = { ...baseEvent, producer: "source_bridge" }
  const result = await handle({
    headers: {
      "x-funnelmetry-source-key-id": "medusa-backend-dev",
      "x-funnelmetry-timestamp": receivedAt,
      "x-funnelmetry-signature": "invalid",
      "x-funnelmetry-request-id": "request-bridge-2",
    },
    body: JSON.stringify(event),
  })

  assert.equal(result.httpStatus, 401)
  assert.equal(result.body.reason_code, "signature_invalid")
  assert.equal(durable.calls.length, 0)
})

test("rejects a credential that belongs to another source", async () => {
  const durable = createDurableFake()
  const handle = createHandler(durable, {
    browserKeys: {
      "other-browser-dev": { source_id: "another-source", secret: "browser-secret" },
    },
  })
  const result = await handle({
    headers: {
      "x-funnelmetry-source-key-id": "other-browser-dev",
      "x-funnelmetry-write-key": "browser-secret",
    },
    body: JSON.stringify(baseEvent),
  })

  assert.equal(result.httpStatus, 401)
  assert.equal(result.body.reason_code, "source_key_mismatch")
  assert.equal(durable.calls.length, 0)
})

test("rejects a signed bridge request outside the replay window", async () => {
  const durable = createDurableFake()
  const handle = createHandler(durable)
  const timestamp = "2026-08-27T02:45:00.000Z"
  const event = { ...baseEvent, producer: "source_bridge" }
  const body = JSON.stringify(event)
  const signature = createHmac("sha256", "backend-secret").update(`${timestamp}.${body}`).digest("hex")
  const result = await handle({
    headers: {
      "x-funnelmetry-source-key-id": "medusa-backend-dev",
      "x-funnelmetry-timestamp": timestamp,
      "x-funnelmetry-signature": signature,
      "x-funnelmetry-request-id": "request-stale",
    },
    body,
  })

  assert.equal(result.httpStatus, 401)
  assert.equal(result.body.reason_code, "timestamp_outside_window")
  assert.equal(durable.calls.length, 0)
})

test("rejects sensitive payload fields before durable handoff", async () => {
  const durable = createDurableFake()
  const handle = createHandler(durable)
  const result = await handle({
    headers: {
      "x-funnelmetry-source-key-id": "medusa-browser-dev",
      "x-funnelmetry-write-key": "browser-secret",
    },
    body: JSON.stringify({ ...baseEvent, source_payload: { email: "customer@example.test" } }),
  })

  assert.equal(result.httpStatus, 400)
  assert.equal(result.body.reason_code, "contract_invalid")
  assert.equal(durable.calls.length, 0)
})

test("returns retryable_failure when the durable handoff fails", async () => {
  const handle = createHandler({
    async accept() {
      throw new Error("broker unavailable")
    },
  })
  const result = await handle({
    headers: {
      "x-funnelmetry-source-key-id": "medusa-browser-dev",
      "x-funnelmetry-write-key": "browser-secret",
    },
    body: JSON.stringify(baseEvent),
  })

  assert.equal(result.httpStatus, 503)
  assert.equal(result.body.status, "retryable_failure")
  assert.equal(result.body.reason_code, "durable_handoff_failed")
  assert.equal(result.body.ingestion_id, undefined)
})

test("preserves a retryable receipt returned by the durable adapter", async () => {
  const handle = createHandler({
    async accept(event, context) {
      return {
        status: "retryable_failure",
        source_id: event.source_id,
        event_id: event.event_id,
        ingestion_attempt_id: context.ingestion_attempt_id,
        received_at: context.received_at,
        reason_code: "broker_timeout",
      }
    },
  })
  const result = await handle({
    headers: {
      "x-funnelmetry-source-key-id": "medusa-browser-dev",
      "x-funnelmetry-write-key": "browser-secret",
    },
    body: JSON.stringify(baseEvent),
  })

  assert.equal(result.httpStatus, 503)
  assert.equal(result.body.reason_code, "broker_timeout")
})

test("durably accepts an event without occurred_at for downstream quality fallback", async () => {
  const durable = createDurableFake()
  const handle = createHandler(durable)
  const { occurred_at, ...withoutOccurredAt } = baseEvent
  const result = await handle({
    headers: {
      "x-funnelmetry-source-key-id": "medusa-browser-dev",
      "x-funnelmetry-write-key": "browser-secret",
    },
    body: JSON.stringify(withoutOccurredAt),
  })

  assert.equal(occurred_at, baseEvent.occurred_at)
  assert.equal(result.httpStatus, 202)
  assert.equal(durable.calls[0].event.occurred_at, undefined)
})
