import assert from "node:assert/strict"
import test from "node:test"
import { createBackendForwarder, createManagedDeliveryDispatcher, normalizeCurrencyCode, normalizeMajorAmount } from "../src/index.js"

const mappedEvent = {
  eventId: "medusa:order.placed:order_1",
  sourceEventType: "medusa.order_placed",
  occurredAt: "2026-08-22T09:00:00.000Z",
  aggregate: { type: "order", id: "order_1" },
  anonymousId: "anonymous:1",
  sessionId: "session:1",
  correlationId: "cart:cart_1",
  sourcePayload: { order_id: "order_1", cart_id: "cart_1", currency_code: "usd", total_amount: "12.00" },
}

test("normalizes ISO currency and Medusa major-unit amounts without minor-unit relabeling", () => {
  assert.equal(normalizeCurrencyCode(" USD "), "usd")
  assert.equal(normalizeCurrencyCode("US"), null)
  assert.equal(normalizeMajorAmount(12.5), "12.5")
  assert.equal(normalizeMajorAmount("12.50"), "12.50")
  assert.equal(normalizeMajorAmount({ numeric: "125000.00" }), "125000.00")
  assert.equal(normalizeMajorAmount({ numeric: 20 }), "20")
  assert.equal(normalizeMajorAmount(-1), null)
  assert.equal(normalizeMajorAmount(Number.POSITIVE_INFINITY), null)
  assert.equal(normalizeMajorAmount("1e3"), null)
})

test("retries a stable signed event and returns the durable receipt", async () => {
  const bodies = []
  let attempts = 0
  const forwarder = createBackendForwarder({
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test/v1/ingress/events",
    signingKey: "test-signing-key",
    now: () => "2026-08-22T09:00:01.000Z",
    requestId: () => "request_1",
    sleep: async () => {},
    fetch: async (_url, request) => {
      bodies.push(request.body)
      attempts += 1
      if (attempts === 1) throw new Error("timeout")
      return {
        status: 202,
        text: async () => JSON.stringify({ status: "accepted", source_id: "medusa-reference", event_id: mappedEvent.eventId, ingestion_id: "ing_1", received_at: "2026-08-22T09:00:01.100Z" }),
      }
    },
  })

  const result = await forwarder.forward(mappedEvent)
  assert.equal(result.status, "accepted")
  assert.equal(new Set(bodies).size, 1)
  assert.equal(forwarder.getMetrics().accepted, 1)
  assert.equal(JSON.parse(bodies[0]).source_schema_version, '1.0')
  assert.equal(JSON.parse(bodies[0]).anonymous_id, "anonymous:1")
  assert.equal(JSON.parse(bodies[0]).session_id, "session:1")
  assert.equal(JSON.parse(bodies[0]).correlation_id, "cart:cart_1")
  await forwarder.forward({ ...mappedEvent, sourceEventType: 'behavior.search_submitted',
    sourcePayload: { search_interaction_id: 'search:1', query_normalized: 'shoes', outcome: 'succeeded', result_count: 1 } })
  assert.equal(JSON.parse(bodies.at(-1)).source_schema_version, '2.0')
  assert.equal(JSON.parse(bodies.at(-1)).producer, 'source_bridge')
})

test("fails open after bounded retries instead of throwing into the host lifecycle", async () => {
  const warnings = []
  const forwarder = createBackendForwarder({
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test",
    signingKey: "test-signing-key",
    maxAttempts: 1,
    sleep: async () => {},
    logger: { warn: (entry) => warnings.push(entry) },
    fetch: async () => { throw new Error("unavailable") },
  })

  const result = await forwarder.forward(mappedEvent)
  assert.equal(result.status, "retryable_failure")
  assert.equal(warnings.length, 1)
})

test("managed dispatcher returns before asynchronous delivery and drops safely when full", async () => {
  let resolveForward
  let startDrain
  const forwarded = []
  const dispatcher = createManagedDeliveryDispatcher({
    maxQueueSize: 1,
    setTimeout: (callback) => {
      startDrain = callback
      return callback
    },
    forwarder: {
      forward: (event) => {
        forwarded.push(event)
        return new Promise((resolve) => { resolveForward = resolve })
      },
    },
  })

  assert.deepEqual(dispatcher.enqueue(mappedEvent), { status: "queued" })
  assert.deepEqual(dispatcher.enqueue({ ...mappedEvent, eventId: "medusa:order.placed:order_2" }), { status: "dropped_queue_full" })
  assert.equal(typeof startDrain, "function")
  startDrain()
  await Promise.resolve()
  assert.equal(forwarded.length, 1)
  resolveForward({ status: "accepted" })
  for (let attempt = 0; attempt < 4 && dispatcher.getMetrics().accepted === 0; attempt += 1) {
    await Promise.resolve()
  }
  assert.equal(dispatcher.getMetrics().accepted, 1)
  assert.equal(dispatcher.getMetrics().droppedQueueFull, 1)
})
