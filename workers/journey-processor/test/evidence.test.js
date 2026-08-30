import test from "node:test"
import assert from "node:assert/strict"
import { extractJourneyEvidence } from "../src/evidence.js"
import { canonicalEvent } from "./fixtures.js"

test("prioritizes direct and business evidence over identity context", () => {
  const evidence = extractJourneyEvidence(canonicalEvent({
    aggregate: { type: "order", id: "order_1", version: "1" },
    relations: { correlation_id: "corr_1", cart_id: "cart_1" },
    identity: { user_id: "user_1", session_id: "session_1", anonymous_id: "anon_1" },
  }))

  assert.deepEqual(evidence.map((item) => item.entity_type), [
    "CORRELATION", "ORDER", "CART", "USER", "SESSION",
  ])
  assert.equal(evidence[0].link_confidence, "STRONG")
  assert.equal(evidence.at(-1).link_confidence, "WEAK")
})

test("does not reuse anonymous identity without subject/time policy", () => {
  const evidence = extractJourneyEvidence(canonicalEvent({ identity: { anonymous_id: "anon_1" } }))
  assert.deepEqual(evidence, [])
})
