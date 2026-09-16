import assert from "node:assert/strict"
import { createHmac } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createSourceIngressHandler } from "../src/relay-handler.js"
import { SourceEventStore } from "../src/relay-repository.js"
import { browserEvent, browserKeys, metrics } from "./helpers.js"

function createHandler() {
  const directory = mkdtempSync(join(tmpdir(), "funnelmetry-source-ingress-handler-test-"))
  const repository = new SourceEventStore({
    databasePath: join(directory, "event-log.sqlite"),
    maxEventLogEvents: 10,
    maxEventLogBytes: 1024 * 1024,
    minFreeDiskBytes: 1,
    createFeedId: () => "feed_handler_1",
  })
  return {
    handler: createSourceIngressHandler({
      repository,
      browserKeys: browserKeys(),
      backendKeys: { "source-backend": { source_id: "medusa-reference", secret: "backend-secret" } },
      metrics: metrics(),
      maxBodyBytes: 1024 * 10,
      maxPayloadBytes: 1024 * 10,
      maxClockSkewMs: 60_000,
      now: () => "2026-09-16T00:00:00.000Z",
      nowMs: () => Date.parse("2026-09-16T00:00:00.000Z"),
    }),
    dispose: () => { repository.close(); rmSync(directory, { recursive: true, force: true }) },
  }
}

test("returns accepted only after a browser event is durable in the Source Event Log", async () => {
  const { handler, dispose } = createHandler()
  try {
    const result = await handler({
      origin: "https://shop.example.test",
      headers: { "x-funnelmetry-source-key-id": "relay-browser", "x-funnelmetry-write-key": "relay-secret" },
      body: JSON.stringify(browserEvent),
    })
    assert.equal(result.httpStatus, 202)
    assert.equal(result.body.status, "accepted")
    assert.equal(result.body.ingress_seq, 1)
    assert.equal(result.body.accepted_at, "2026-09-16T00:00:00.000Z")
  } finally {
    dispose()
  }
})

test("returns duplicate with the original ingress sequence", async () => {
  const { handler, dispose } = createHandler()
  try {
    const request = {
      origin: "https://shop.example.test",
      headers: { "x-funnelmetry-source-key-id": "relay-browser", "x-funnelmetry-write-key": "relay-secret" },
      body: JSON.stringify(browserEvent),
    }
    await handler(request)
    const duplicate = await handler(request)
    assert.equal(duplicate.httpStatus, 200)
    assert.equal(duplicate.body.status, "duplicate")
    assert.equal(duplicate.body.ingress_seq, 1)
  } finally {
    dispose()
  }
})

test("accepts a signed Medusa source bridge event without allowing browser credentials to impersonate it", async () => {
  const { handler, dispose } = createHandler()
  try {
    const event = {
      ...browserEvent,
      event_id: "medusa:order.placed:order_1",
      source_event_type: "medusa.order_placed",
      producer: "source_bridge",
      aggregate: { type: "order", id: "order_1" },
      source_payload: { order_id: "order_1", currency_code: "usd" },
    }
    const body = JSON.stringify(event)
    const timestamp = "2026-09-16T00:00:00.000Z"
    const signature = createHmac("sha256", "backend-secret").update(`${timestamp}.${body}`).digest("hex")
    const result = await handler({
      headers: {
        "x-funnelmetry-source-key-id": "source-backend",
        "x-funnelmetry-timestamp": timestamp,
        "x-funnelmetry-request-id": "req_1",
        "x-funnelmetry-signature": signature,
      },
      body,
    })
    assert.equal(result.httpStatus, 202)
    assert.equal(result.body.status, "accepted")
  } finally {
    dispose()
  }
})
