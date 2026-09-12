import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { RelayError } from "../src/errors.js"
import { RelayRepository } from "../src/relay-repository.js"
import { browserEvent } from "./helpers.js"

function createRepository(overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "funnelmetry-relay-test-"))
  const repository = new RelayRepository({
    databasePath: join(directory, "relay.sqlite"),
    maxSpoolEvents: 10,
    maxSpoolBytes: 1024 * 1024,
    minFreeDiskBytes: 1,
    createRelayId: () => "rel_test_1",
    ...overrides,
  })
  return { repository, dispose: () => { repository.close(); rmSync(directory, { recursive: true, force: true }) } }
}

test("durably enqueues an event and returns the original relay row for a matching duplicate", () => {
  const { repository, dispose } = createRepository()
  try {
    const rawBody = JSON.stringify(browserEvent)
    const first = repository.enqueue({ event: browserEvent, rawBody, receivedAt: "2026-09-11T00:00:00.000Z" })
    const duplicate = repository.enqueue({ event: browserEvent, rawBody, receivedAt: "2026-09-11T00:01:00.000Z" })
    assert.equal(first.duplicate, false)
    assert.equal(duplicate.duplicate, true)
    assert.equal(duplicate.record.relay_id, first.record.relay_id)
    assert.equal(repository.getStatus("2026-09-11T00:01:00.000Z").event_count, 1)
  } finally {
    dispose()
  }
})

test("rejects a conflicting payload that reuses an event identity", () => {
  const { repository, dispose } = createRepository()
  try {
    repository.enqueue({ event: browserEvent, rawBody: JSON.stringify(browserEvent), receivedAt: "2026-09-11T00:00:00.000Z" })
    const conflicting = { ...browserEvent, source_payload: { product_id: "prod_2" } }
    assert.throws(
      () => repository.enqueue({ event: conflicting, rawBody: JSON.stringify(conflicting), receivedAt: "2026-09-11T00:00:01.000Z" }),
      (error) => error instanceof RelayError && error.code === "event_identity_conflict",
    )
  } finally {
    dispose()
  }
})

test("reclaims a delivery lease after a worker crash and can mark the event delivered", () => {
  const { repository, dispose } = createRepository()
  try {
    const stored = repository.enqueue({ event: browserEvent, rawBody: JSON.stringify(browserEvent), receivedAt: "2026-09-11T00:00:00.000Z" })
    const firstClaim = repository.claimDue({ now: "2026-09-11T00:00:00.000Z", owner: "worker-a", leaseMs: 1000, limit: 1 })
    assert.equal(firstClaim.length, 1)
    const recovered = repository.claimDue({ now: "2026-09-11T00:00:02.000Z", owner: "worker-b", leaseMs: 1000, limit: 1 })
    assert.equal(recovered.length, 1)
    assert.equal(repository.markDelivered({
      relayId: stored.record.relay_id,
      owner: "worker-b",
      receipt: { status: "accepted", ingestion_id: "ing_1" },
      deliveredAt: "2026-09-11T00:00:03.000Z",
    }), true)
    assert.equal(repository.getStatus("2026-09-11T00:00:03.000Z").state_counts.DELIVERED, 1)
  } finally {
    dispose()
  }
})
