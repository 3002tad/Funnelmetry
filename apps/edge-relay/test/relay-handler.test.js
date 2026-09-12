import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createRelayHandler } from "../src/relay-handler.js"
import { RelayRepository } from "../src/relay-repository.js"
import { browserEvent, browserKeys, metrics } from "./helpers.js"

function createHandler() {
  const directory = mkdtempSync(join(tmpdir(), "funnelmetry-relay-handler-test-"))
  const repository = new RelayRepository({
    databasePath: join(directory, "relay.sqlite"),
    maxSpoolEvents: 10,
    maxSpoolBytes: 1024 * 1024,
    minFreeDiskBytes: 1,
    createRelayId: () => "rel_handler_1",
  })
  return {
    handler: createRelayHandler({
      repository,
      browserKeys: browserKeys(),
      metrics: metrics(),
      maxBodyBytes: 1024 * 10,
      maxPayloadBytes: 1024 * 10,
      now: () => "2026-09-11T00:00:00.000Z",
    }),
    dispose: () => { repository.close(); rmSync(directory, { recursive: true, force: true }) },
  }
}

test("returns relay_queued only after a valid browser event is durable", async () => {
  const { handler, dispose } = createHandler()
  try {
    const result = await handler({
      origin: "https://shop.example.test",
      headers: {
        "x-funnelmetry-source-key-id": "relay-browser",
        "x-funnelmetry-write-key": "relay-secret",
      },
      body: JSON.stringify(browserEvent),
    })
    assert.equal(result.httpStatus, 202)
    assert.equal(result.body.status, "relay_queued")
    assert.equal(result.body.event_id, browserEvent.event_id)
  } finally {
    dispose()
  }
})

test("does not let an unapproved origin enqueue an event", async () => {
  const { handler, dispose } = createHandler()
  try {
    const result = await handler({
      origin: "https://other.example.test",
      headers: {
        "x-funnelmetry-source-key-id": "relay-browser",
        "x-funnelmetry-write-key": "relay-secret",
      },
      body: JSON.stringify(browserEvent),
    })
    assert.equal(result.httpStatus, 403)
  } finally {
    dispose()
  }
})
