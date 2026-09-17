import assert from "node:assert/strict"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import { RelayError } from "../src/errors.js"
import { SourceEventStore } from "../src/relay-repository.js"
import { browserEvent } from "./helpers.js"

function createStore(overrides = {}) {
  const directory = mkdtempSync(join(tmpdir(), "funnelmetry-source-event-store-test-"))
  const store = new SourceEventStore({
    databasePath: join(directory, "event-log.sqlite"),
    maxEventLogEvents: 10,
    maxEventLogBytes: 1024 * 1024,
    minFreeDiskBytes: 1,
    createFeedId: () => "feed_test_1",
    ...overrides,
  })
  return { store, dispose: () => { store.close(); rmSync(directory, { recursive: true, force: true }) } }
}

function accept(store, event, acceptedAt = "2026-09-16T00:00:00.000Z") {
  return store.accept({
    event,
    rawBody: JSON.stringify(event),
    acceptedAt,
    transportMetadata: { producer: event.producer, authentication: { method: "test" } },
  })
}

test("durably accepts an event, assigns a Source-owned sequence, and returns it for a matching duplicate", () => {
  const { store, dispose } = createStore()
  try {
    const first = accept(store, browserEvent)
    const duplicate = accept(store, browserEvent, "2026-09-16T00:01:00.000Z")
    assert.equal(first.duplicate, false)
    assert.equal(first.record.event_feed_id, "feed_test_1")
    assert.equal(first.record.ingress_seq, 1)
    assert.equal(duplicate.duplicate, true)
    assert.equal(duplicate.record.ingress_seq, first.record.ingress_seq)
    assert.equal(duplicate.record.accepted_at, first.record.accepted_at)
  } finally {
    dispose()
  }
})

test("rejects conflicting reuse of a stable source event identity", () => {
  const { store, dispose } = createStore()
  try {
    accept(store, browserEvent)
    const conflicting = { ...browserEvent, source_payload: { product_id: "prod_conflict" } }
    assert.throws(() => accept(store, conflicting), (error) => error instanceof RelayError && error.code === "event_identity_conflict")
  } finally {
    dispose()
  }
})

test("returns the ordered feed range and derives next_after_seq from the final returned record", () => {
  const { store, dispose } = createStore()
  try {
    const second = { ...browserEvent, event_id: "browser:evt-124", source_payload: { product_id: "prod_2" } }
    const third = { ...browserEvent, event_id: "browser:evt-125", source_payload: { product_id: "prod_3" } }
    accept(store, browserEvent)
    accept(store, second)
    accept(store, third)
    const feed = store.getFeed({ afterSeq: 0, limit: 2 })
    assert.equal(feed.event_feed_id, "feed_test_1")
    assert.deepEqual(feed.events.map((event) => event.ingress_seq), [1, 2])
    assert.equal(feed.next_after_seq, 2)
    assert.equal(feed.events[0].transport_metadata.authentication.method, "test")
    assert.equal(feed.latest_available_seq, 3)
    assert.equal(feed.earliest_available_seq, 1)
    assert.equal(feed.retention_floor_seq, 0)
  } finally {
    dispose()
  }
})

test("wakes an in-flight long poll only when a later source record is accepted", async () => {
  const { store, dispose } = createStore()
  try {
    const pending = store.waitForRecordAfter(0, 500)
    setTimeout(() => accept(store, browserEvent), 10)
    assert.equal(await pending, true)
  } finally {
    dispose()
  }
})
