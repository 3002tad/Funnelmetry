import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { createDeliveryWorker } from "../src/delivery-worker.js"
import { RelayRepository } from "../src/relay-repository.js"
import { browserEvent, metrics } from "./helpers.js"

test("delivers a queued event when the upstream becomes available", async () => {
  const directory = mkdtempSync(join(tmpdir(), "funnelmetry-relay-worker-test-"))
  const repository = new RelayRepository({
    databasePath: join(directory, "relay.sqlite"),
    maxSpoolEvents: 10,
    maxSpoolBytes: 1024 * 1024,
    minFreeDiskBytes: 1,
    createRelayId: () => "rel_worker_1",
  })
  let clock = "2026-09-11T00:00:00.000Z"
  try {
    repository.enqueue({ event: browserEvent, rawBody: JSON.stringify(browserEvent), receivedAt: clock })
    const worker = createDeliveryWorker({
      repository,
      upstream: { forward: async () => ({ status: "accepted", source_id: browserEvent.source_id, event_id: browserEvent.event_id, ingestion_id: "ing_1" }) },
      upstreamEnabled: true,
      instanceId: "worker-test",
      leaseMs: 1000,
      intervalMs: 1000,
      batchSize: 10,
      retryMinMs: 1000,
      retryMaxMs: 1000,
      metrics: metrics(),
      now: () => clock,
    })
    await worker.tick()
    assert.equal(repository.getStatus(clock).state_counts.DELIVERED, 1)
    assert.equal(worker.getStatus().state, "connected")
  } finally {
    repository.close()
    rmSync(directory, { recursive: true, force: true })
  }
})
