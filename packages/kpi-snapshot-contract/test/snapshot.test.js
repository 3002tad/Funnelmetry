import test from "node:test"
import assert from "node:assert/strict"
import { buildKpiSnapshot, hashKpiSnapshot } from "../src/index.js"

const instance = {
  funnel_instance_id: "funnel-1", source_id: "source-one", journey_id: "journey-1",
  funnel_profile_id: "commerce", profile_version: "1.0.0",
  entry_at: "2026-09-02T00:00:00Z", conversion_deadline: "2026-09-02T01:00:00Z",
  outcome_status: "IN_PROGRESS", quality_status: "PROVISIONAL", converted_at: null,
  total_step_count: "2",
}

test("builds a deterministic normalized KPI snapshot", () => {
  const snapshot = buildKpiSnapshot(instance, [{
    step_index: 0, step_id: "view", event_type: "behavior.product_viewed",
    first_reached_at: "2026-09-02T00:00:00Z", last_reached_at: "2026-09-02T00:00:00Z",
    occurrence_count: "1",
  }], [])
  assert.equal(snapshot.entry_at, "2026-09-02T00:00:00.000Z")
  assert.equal(snapshot.total_step_count, 2)
  assert.equal(snapshot.steps[0].occurrence_count, 1)
  assert.match(hashKpiSnapshot(snapshot), /^[a-f0-9]{64}$/)
  assert.notEqual(
    hashKpiSnapshot(snapshot),
    hashKpiSnapshot(buildKpiSnapshot({ ...instance, outcome_status: "DROPPED" }, snapshot.steps, [])),
  )
})
