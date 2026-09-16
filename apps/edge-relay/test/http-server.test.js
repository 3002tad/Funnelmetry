import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createSourceIngressHttpServer } from "../src/http-server.js"
import { createSourceIngressHandler } from "../src/relay-handler.js"
import { SourceEventStore } from "../src/relay-repository.js"
import { browserEvent, browserKeys, metrics } from "./helpers.js"

async function createRuntime() {
  const directory = mkdtempSync(join(tmpdir(), "funnelmetry-source-ingress-http-test-"))
  const repository = new SourceEventStore({
    databasePath: join(directory, "event-log.sqlite"),
    maxEventLogEvents: 10,
    maxEventLogBytes: 1024 * 1024,
    minFreeDiskBytes: 1,
    createFeedId: () => "feed_http_1",
  })
  const metricStore = metrics()
  const handler = createSourceIngressHandler({
    repository,
    browserKeys: browserKeys(),
    backendKeys: { "source-backend": { source_id: "medusa-reference", secret: "backend-secret" } },
    metrics: metricStore,
    maxBodyBytes: 1024 * 10,
    maxPayloadBytes: 1024 * 10,
    maxClockSkewMs: 60_000,
  })
  const server = createSourceIngressHttpServer({
    handleSourceIngress: handler,
    repository,
    metrics: metricStore,
    browserKeys: browserKeys(),
    maxBodyBytes: 1024 * 10,
    adminToken: "admin-token",
    eventFeedTokens: { connector: "connector-token" },
    eventFeedMaxLimit: 10,
    eventFeedMaxWaitSeconds: 1,
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  const { port } = server.address()
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    dispose: async () => {
      await new Promise((resolve) => server.close(resolve))
      repository.close()
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

test("requires a bearer token and returns the feed with an explicit cursor response", async () => {
  const runtime = await createRuntime()
  try {
    const body = JSON.stringify(browserEvent)
    const accepted = await fetch(`${runtime.baseUrl}/v1/ingress/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "origin": "https://shop.example.test",
        "x-funnelmetry-source-key-id": "relay-browser",
        "x-funnelmetry-write-key": "relay-secret",
      },
      body,
    })
    assert.equal(accepted.status, 202)
    assert.equal((await accepted.json()).ingress_seq, 1)

    const denied = await fetch(`${runtime.baseUrl}/v1/events?after_seq=0`)
    assert.equal(denied.status, 401)

    const response = await fetch(`${runtime.baseUrl}/v1/events?after_seq=0&limit=1`, {
      headers: { authorization: "Bearer connector-token" },
    })
    assert.equal(response.status, 200)
    const feed = await response.json()
    assert.equal(feed.event_feed_id, "feed_http_1")
    assert.equal(feed.events.length, 1)
    assert.equal(feed.events[0].ingress_seq, 1)
    assert.equal(feed.next_after_seq, 1)
  } finally {
    await runtime.dispose()
  }
})

test("long poll returns immediately once a later event has been durably accepted", async () => {
  const runtime = await createRuntime()
  try {
    const pending = fetch(`${runtime.baseUrl}/v1/events?after_seq=0&limit=10&wait=1`, {
      headers: { authorization: "Bearer connector-token" },
    })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const accepted = await fetch(`${runtime.baseUrl}/v1/ingress/events`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "origin": "https://shop.example.test",
        "x-funnelmetry-source-key-id": "relay-browser",
        "x-funnelmetry-write-key": "relay-secret",
      },
      body: JSON.stringify(browserEvent),
    })
    assert.equal(accepted.status, 202)
    const response = await pending
    const feed = await response.json()
    assert.equal(feed.events.length, 1)
    assert.equal(feed.events[0].event_id, browserEvent.event_id)
  } finally {
    await runtime.dispose()
  }
})
