import test from "node:test"
import assert from "node:assert/strict"
import { createJourneyRepository, JourneyResolutionConflictError } from "../src/repository.js"
import { canonicalEvent } from "./fixtures.js"

function fakePool({ existingEvent, matches = [], ownerJourneyId } = {}) {
  const calls = []
  let released = false
  const client = {
    async query(sql, params) {
      const text = sql.trim()
      calls.push({ text, params })
      if (text.includes("FROM journey_events") && text.startsWith("SELECT")) {
        return existingEvent ? { rowCount: 1, rows: [existingEvent] } : { rowCount: 0, rows: [] }
      }
      if (text.startsWith("SELECT entity_type")) return { rowCount: matches.length, rows: matches }
      if (text.startsWith("SELECT journey_id FROM journey_entities")) {
        return { rowCount: 1, rows: [{ journey_id: ownerJourneyId ?? matches[0]?.journey_id }] }
      }
      return { rowCount: 1, rows: [] }
    },
    release() { released = true },
  }
  return {
    calls,
    get released() { return released },
    connect: async () => client,
  }
}

test("creates an isolated journey when no reusable evidence exists", async () => {
  const pool = fakePool()
  const result = await createJourneyRepository({
    pool,
    now: () => "2026-08-29T01:00:03.000Z",
  }).resolve(canonicalEvent())

  assert.equal(result.status, "linked")
  assert.match(result.journey_id, /^journey_[a-f0-9]{64}$/)
  assert.equal(result.link_method, "NEW_JOURNEY")
  assert.equal(result.link_confidence, "ISOLATED")
  assert.equal(pool.released, true)
})

test("links another event through an existing strong correlation", async () => {
  const pool = fakePool({
    matches: [{ entity_type: "CORRELATION", entity_key: "corr_1", journey_id: "journey_1" }],
    ownerJourneyId: "journey_1",
  })
  const result = await createJourneyRepository({
    pool,
    now: () => "2026-08-29T01:00:03.000Z",
  }).resolve(canonicalEvent({ relations: { correlation_id: "corr_1" } }))

  assert.equal(result.journey_id, "journey_1")
  assert.equal(result.link_method, "DIRECT_CORRELATION")
  assert.equal(result.link_confidence, "STRONG")
})

test("returns the stored resolution for a physical redelivery", async () => {
  const pool = fakePool({
    existingEvent: {
      canonical_event_id: "can_1",
      journey_id: "journey_1",
      link_method: "SESSION_CONTEXT",
      link_confidence: "WEAK",
      matched_entity_type: "SESSION",
      matched_entity_key: "session_1",
      linked_at: new Date("2026-08-29T01:00:03.000Z"),
    },
  })
  const result = await createJourneyRepository({ pool }).resolve(canonicalEvent())

  assert.equal(result.status, "duplicate")
  assert.equal(result.journey_id, "journey_1")
  assert.equal(result.linked_at, "2026-08-29T01:00:03.000Z")
})

test("rolls back instead of blindly merging conflicting journeys", async () => {
  const pool = fakePool({
    matches: [
      { entity_type: "CORRELATION", entity_key: "corr_1", journey_id: "journey_1" },
      { entity_type: "SESSION", entity_key: "session_1", journey_id: "journey_2" },
    ],
  })
  const event = canonicalEvent({
    relations: { correlation_id: "corr_1" },
    identity: { session_id: "session_1" },
  })

  await assert.rejects(
    () => createJourneyRepository({ pool }).resolve(event),
    JourneyResolutionConflictError,
  )
  assert.equal(pool.calls.at(-1).text, "ROLLBACK")
})
