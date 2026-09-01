import test from "node:test"
import assert from "node:assert/strict"
import {
  calculateFunnelTimeBounds,
  classifyCanonicalEventArrival,
  classifyFunnelMaturity,
  validateFunnelTimePolicy,
} from "../src/index.js"

const entryAt = "2026-09-01T00:00:00.000Z"
const policy = Object.freeze({
  conversion_horizon_seconds: 3600,
  late_arrival_grace_seconds: 600,
  transition_timeouts_seconds: { checkout: 300 },
})

test("keeps reference profiles unconfigured instead of inventing numeric policy", () => {
  const result = validateFunnelTimePolicy({
    conversion_horizon_seconds: null,
    late_arrival_grace_seconds: null,
  })
  assert.equal(result.configured, false)
  assert.equal(classifyFunnelMaturity({ entry_at: entryAt, observed_at: entryAt, policy: result }).state, "UNCONFIGURED")
})

test("requires horizon and grace to be configured together", () => {
  assert.throws(
    () => validateFunnelTimePolicy({ conversion_horizon_seconds: 3600, late_arrival_grace_seconds: null }),
    /must be configured together/,
  )
})

test("rejects invalid transition policy instead of silently disabling it", () => {
  assert.throws(
    () => validateFunnelTimePolicy({ ...policy, transition_timeouts_seconds: { checkout: null } }),
    /must be a positive integer/,
  )
})

test("calculates conversion deadline and finalization boundary from profile policy", () => {
  assert.deepEqual(calculateFunnelTimeBounds({ entry_at: entryAt, policy }), {
    configured: true,
    entry_at: entryAt,
    conversion_deadline: "2026-09-01T01:00:00.000Z",
    finalization_at: "2026-09-01T01:10:00.000Z",
  })
})

test("keeps an instance pending before a configured transition timeout", () => {
  const result = classifyFunnelMaturity({
    entry_at: entryAt,
    observed_at: "2026-09-01T00:04:59.000Z",
    last_reached_at: entryAt,
    next_step_id: "checkout",
    policy,
  })
  assert.equal(result.state, "PENDING")
})

test("marks suspected drop-off at transition timeout without finalizing the instance", () => {
  const result = classifyFunnelMaturity({
    entry_at: entryAt,
    observed_at: "2026-09-01T00:05:00.000Z",
    last_reached_at: entryAt,
    next_step_id: "checkout",
    policy,
  })
  assert.equal(result.state, "SUSPECTED_DROPOFF")
  assert.equal(result.suspected_dropoff_at, "2026-09-01T00:05:00.000Z")
})

test("matures only at horizon plus grace", () => {
  assert.equal(classifyFunnelMaturity({
    entry_at: entryAt, observed_at: "2026-09-01T01:10:00.000Z", policy,
  }).state, "PENDING")
  assert.equal(classifyFunnelMaturity({
    entry_at: entryAt, observed_at: "2026-09-01T01:10:00.001Z", policy,
  }).state, "MATURED")
})

test("classifies authoritative arrival relative to horizon and grace", () => {
  const classify = (occurred_at, ingested_at) => classifyCanonicalEventArrival({
    entry_at: entryAt, occurred_at, ingested_at, time_basis: "source_occurred", policy,
  }).classification
  assert.equal(classify("2026-09-01T00:30:00.000Z", "2026-09-01T00:30:01.000Z"), "ON_TIME")
  assert.equal(classify("2026-09-01T01:00:00.000Z", "2026-09-01T01:00:00.000Z"), "ON_TIME")
  assert.equal(classify("2026-09-01T00:59:00.000Z", "2026-09-01T01:05:00.000Z"), "LATE_ARRIVAL_WITHIN_GRACE")
  assert.equal(classify("2026-09-01T00:59:00.000Z", "2026-09-01T01:10:00.000Z"), "LATE_ARRIVAL_WITHIN_GRACE")
  assert.equal(classify("2026-09-01T00:59:00.000Z", "2026-09-01T01:11:00.000Z"), "TOO_LATE_FOR_FINAL_COHORT")
  assert.equal(classify("2026-09-01T01:00:01.000Z", "2026-09-01T01:00:02.000Z"), "AFTER_HORIZON")
})

test("does not use fallback time as authoritative funnel evidence", () => {
  const result = classifyCanonicalEventArrival({
    entry_at: entryAt,
    occurred_at: "2026-09-01T00:30:00.000Z",
    ingested_at: "2026-09-01T00:30:00.000Z",
    time_basis: "ingress_fallback",
    policy,
  })
  assert.equal(result.classification, "NON_AUTHORITATIVE_TIME")
})

test("surfaces unresolved clock skew instead of applying an invented tolerance", () => {
  const result = classifyCanonicalEventArrival({
    entry_at: entryAt,
    occurred_at: "2026-09-01T00:30:10.000Z",
    ingested_at: "2026-09-01T00:30:00.000Z",
    time_basis: "source_occurred",
    policy,
  })
  assert.equal(result.classification, "CLOCK_SKEW_UNRESOLVED")
})
