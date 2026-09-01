import assert from "node:assert/strict"
import test from "node:test"
import { IngressTelemetryConflictError, createIngressTelemetryRepository } from "../src/repository.js"

const receipt = Object.freeze({
  status: "accepted",
  source_id: "medusa-reference",
  event_id: "browser:event-1",
  ingestion_id: "ing_1",
  ingestion_attempt_id: "attempt-1",
  received_at: "2026-09-01T01:00:00.000Z",
})

const outcome = Object.freeze({
  source_id: "medusa-reference",
  source_event_id: "browser:event-1",
  status: "normalized",
  canonical_event_id: "can_1",
  mapping_version: "mapping-v1",
  processed_at: "2026-09-01T01:00:01.000Z",
  raw_record_id: "ing_1",
})

function fakePool({ insertRowCount = 1, identical = true } = {}) {
  const calls = []
  let released = false
  const client = {
    async query(sql, params) {
      const text = sql.trim()
      calls.push({ text, params })
      if (text.startsWith("INSERT INTO")) return {
        rowCount: insertRowCount,
        rows: insertRowCount ? [{ recorded_at: new Date("2026-09-01T01:00:02.000Z") }] : [],
      }
      if (text.startsWith("SELECT")) return {
        rowCount: 1,
        rows: [{ identical, recorded_at: new Date("2026-09-01T01:00:02.000Z") }],
      }
      return { rowCount: 0, rows: [] }
    },
    release() { released = true },
  }
  return {
    calls,
    get released() { return released },
    connect: async () => client,
  }
}

test("persists an accepted receipt transactionally", async () => {
  const pool = fakePool()
  const result = await createIngressTelemetryRepository({ pool }).persistReceipt(receipt)
  assert.equal(result.status, "inserted")
  assert.deepEqual(pool.calls.map((call) => call.text.split(/\s+/)[0]), ["BEGIN", "INSERT", "COMMIT"])
  assert.equal(pool.released, true)
})

test("persists a versioned canonicalization outcome transactionally", async () => {
  const pool = fakePool()
  const result = await createIngressTelemetryRepository({ pool }).persistOutcome(outcome)
  assert.equal(result.status, "inserted")
  assert.equal(pool.calls[1].params[2], "mapping-v1")
})

test("treats identical telemetry redelivery as a duplicate", async () => {
  const pool = fakePool({ insertRowCount: 0, identical: true })
  const result = await createIngressTelemetryRepository({ pool }).persistOutcome(outcome)
  assert.equal(result.status, "duplicate")
  assert.deepEqual(pool.calls.map((call) => call.text.split(/\s+/)[0]), ["BEGIN", "INSERT", "SELECT", "COMMIT"])
})

test("rolls back conflicting immutable telemetry", async () => {
  const pool = fakePool({ insertRowCount: 0, identical: false })
  await assert.rejects(
    () => createIngressTelemetryRepository({ pool }).persistReceipt(receipt),
    IngressTelemetryConflictError,
  )
  assert.equal(pool.calls.at(-1).text, "ROLLBACK")
})

test("rejects non-accepted receipts before opening PostgreSQL", async () => {
  let connected = false
  const repository = createIngressTelemetryRepository({
    pool: { connect: async () => { connected = true } },
  })
  await assert.rejects(
    () => repository.persistReceipt({ ...receipt, status: "duplicate" }),
    /must contain accepted receipts/,
  )
  assert.equal(connected, false)
})
