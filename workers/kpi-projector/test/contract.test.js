import test from "node:test"
import assert from "node:assert/strict"
import { validateFunnelUpdatedEnvelope } from "../src/contract.js"

const envelope = {
  status: "funnel_updated",
  projection_status: "projected",
  canonical_event_id: "can_1",
  journey_id: "journey_1",
  updates: [{ funnel_instance_id: "funnel_1" }],
}

test("validates the funnel handoff and preserves its scoped instance ids", () => {
  const value = validateFunnelUpdatedEnvelope(envelope, ["source-one", "journey_1"])
  assert.deepEqual(value.instanceIds, ["funnel_1"])
  assert.equal(value.triggerEventId, "can_1")
})

test("rejects a journey key mismatch", () => {
  assert.throws(() => validateFunnelUpdatedEnvelope(envelope, ["source-one", "journey_2"]), /does not match/)
})

test("rejects duplicate instance ids before projection", () => {
  assert.throws(
    () => validateFunnelUpdatedEnvelope({ ...envelope, updates: [...envelope.updates, ...envelope.updates] }, ["source-one", "journey_1"]),
    /duplicate instance ids/,
  )
})
