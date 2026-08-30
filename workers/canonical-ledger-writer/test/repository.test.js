import test from "node:test"
import assert from "node:assert/strict"
import {
  CanonicalLedgerConflictError,
  createCanonicalLedgerRepository,
} from "../src/repository.js"
import { canonicalEvent } from "./fixtures.js"

function fakePool({ insertRowCount = 1, identical = true } = {}) {
  const calls = []
  let released = false
  const client = {
    async query(sql, params) {
      const text = sql.trim()
      calls.push({ text, params })
      if (text.startsWith("INSERT INTO")) return {
        rowCount: insertRowCount,
        rows: insertRowCount ? [{ canonical_event_id: "can_1", persisted_at: new Date("2026-08-29T01:00:03.000Z") }] : [],
      }
      if (text.startsWith("SELECT canonical_document")) return {
        rowCount: 1,
        rows: [{ identical, persisted_at: new Date("2026-08-29T01:00:03.000Z") }],
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

test("inserts a canonical event inside a database transaction", async () => {
  const pool = fakePool()
  const repository = createCanonicalLedgerRepository({ pool })
  const result = await repository.persist(canonicalEvent)

  assert.equal(result.status, "inserted")
  assert.equal(result.persisted_at, "2026-08-29T01:00:03.000Z")
  assert.deepEqual(pool.calls.map((call) => call.text.split(/\s+/)[0]), ["BEGIN", "INSERT", "COMMIT"])
  assert.equal(pool.released, true)
})

test("treats an identical physical redelivery as an idempotent duplicate", async () => {
  const pool = fakePool({ insertRowCount: 0, identical: true })
  const result = await createCanonicalLedgerRepository({ pool }).persist(canonicalEvent)

  assert.equal(result.status, "duplicate")
  assert.equal(result.persisted_at, "2026-08-29T01:00:03.000Z")
  assert.deepEqual(pool.calls.map((call) => call.text.split(/\s+/)[0]), ["BEGIN", "INSERT", "SELECT", "COMMIT"])
})

test("rolls back when a stable canonical ID has different content", async () => {
  const pool = fakePool({ insertRowCount: 0, identical: false })
  await assert.rejects(
    () => createCanonicalLedgerRepository({ pool }).persist(canonicalEvent),
    CanonicalLedgerConflictError,
  )
  assert.equal(pool.calls.at(-1).text, "ROLLBACK")
  assert.equal(pool.released, true)
})

test("validates the canonical contract before opening a database connection", async () => {
  let connected = false
  const repository = createCanonicalLedgerRepository({
    pool: { connect: async () => { connected = true } },
  })
  await assert.rejects(() => repository.persist({ canonical_event_id: "invalid" }), /canonical_schema_version/)
  assert.equal(connected, false)
})
