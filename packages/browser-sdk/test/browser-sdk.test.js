import assert from "node:assert/strict"
import test from "node:test"
import { createBrowserSdk } from "../src/index.js"

function receipt(status, eventId, extra = {}) {
  return JSON.stringify({ status, source_id: "medusa-reference", event_id: eventId, received_at: "2026-08-22T09:00:00.000Z", ...extra })
}

test("rejects event types outside the approved behavior catalog", () => {
  assert.throws(() => createBrowserSdk({
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test",
    writeKey: "public-write-key",
    allowedEventTypes: ["behavior.raw_dom_captured"],
  }), /Behavior Event Catalog v1/)
})

test("keeps the same event in the queue until a durable receipt arrives", async () => {
  const sent = []
  let attempts = 0
  const sdk = createBrowserSdk({
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test/v1/ingress/events",
    writeKey: "public-write-key",
    allowedEventTypes: ["behavior.product_viewed"],
    hasConsent: () => true,
    createEventId: () => "browser:stable-1",
    now: () => "2026-08-22T09:00:00.000Z",
    sleep: async () => {},
    fetch: async (_url, request) => {
      sent.push(JSON.parse(request.body))
      attempts += 1
      if (attempts < 3) throw new Error("network unavailable")
      return { status: 202, text: async () => receipt("accepted", "browser:stable-1", { ingestion_id: "ing_1" }) }
    },
  })

  await sdk.track("behavior.product_viewed", { product_id: "prod_1" })
  assert.equal(sent.length, 3)
  assert.equal(new Set(sent.map((event) => event.event_id)).size, 1)
  assert.equal(sdk.getMetrics().queued, 0)
})

test("does not enqueue browser data without explicit consent", async () => {
  const sdk = createBrowserSdk({
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test",
    writeKey: "public-write-key",
    allowedEventTypes: ["behavior.product_viewed"],
    hasConsent: () => false,
    fetch: async () => { throw new Error("must not send") },
  })

  assert.deepEqual(await sdk.track("behavior.product_viewed", { product_id: "prod_1" }), { status: "skipped_no_consent" })
})

test("retains a retryable event for a later flush instead of silently dropping it", async () => {
  const storageValues = new Map()
  const storage = { getItem: (key) => storageValues.get(key) ?? null, setItem: (key, value) => storageValues.set(key, value) }
  let available = false
  const sdk = createBrowserSdk({
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-dev",
    endpoint: "https://ingest.example.test",
    writeKey: "public-write-key",
    allowedEventTypes: ["behavior.product_viewed"],
    hasConsent: () => true,
    createEventId: () => "browser:stable-2",
    now: () => "2026-08-22T09:00:00.000Z",
    sleep: async () => {},
    storage,
    maxAttempts: 1,
    fetch: async () => {
      if (!available) throw new Error("unavailable")
      return { status: 202, text: async () => receipt("accepted", "browser:stable-2", { ingestion_id: "ing_2" }) }
    },
  })

  assert.equal((await sdk.track("behavior.product_viewed", { product_id: "prod_1" })).status, "retryable_failure")
  assert.equal(sdk.getMetrics().queued, 1)
  available = true
  await sdk.flush()
  assert.equal(sdk.getMetrics().queued, 0)
})

test("removes an event after a durable Relay receipt without counting it as Pipeline accepted", async () => {
  const sdk = createBrowserSdk({
    sourceId: "medusa-reference",
    sourceKeyId: "medusa-reference-relay",
    endpoint: "https://relay.example.test/v1/ingress/events",
    writeKey: "public-write-key",
    allowedEventTypes: ["behavior.product_viewed"],
    hasConsent: () => true,
    createEventId: () => "browser:relay-stable-1",
    now: () => "2026-09-11T00:00:00.000Z",
    fetch: async () => ({
      status: 202,
      text: async () => JSON.stringify({
        specversion: "relay-receipt.v1",
        status: "relay_queued",
        relay_id: "rel_1",
        source_id: "medusa-reference",
        event_id: "browser:relay-stable-1",
        relay_received_at: "2026-09-11T00:00:00.000Z",
      }),
    }),
  })

  await sdk.track("behavior.product_viewed", { product_id: "prod_1" })
  assert.equal(sdk.getMetrics().queued, 0)
  assert.equal(sdk.getMetrics().relayQueued, 1)
  assert.equal(sdk.getMetrics().accepted, 0)
})
