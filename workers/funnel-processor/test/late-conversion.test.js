import test from "node:test"
import assert from "node:assert/strict"
import { lateConversionCandidate } from "../src/repository.js"
import { canonicalEvent, commerceProfile } from "./fixtures.js"

const profile = Object.freeze({
  ...commerceProfile,
  conversion_horizon_seconds: 60,
  late_arrival_grace_seconds: 10,
})

const instance = Object.freeze({
  funnel_instance_id: "funnel_1",
  outcome_status: "DROPPED",
  entry_at: "2026-08-29T01:00:00.000Z",
})

function completedProjection(eventId = "can_order") {
  return {
    outcome_status: "CONVERTED",
    steps: profile.ordered_steps.map((step, step_index) => ({
      step_index,
      step_id: step.step_id,
      representative_event_id: step_index === 3 ? eventId : `can_${step.step_id}`,
    })),
  }
}

function lateOrder(overrides = {}) {
  return canonicalEvent({
    canonical_event_id: "can_order",
    source_event_id: "source:late-order",
    event_type: "order.accepted",
    event_class: "BUSINESS_FACT",
    occurred_at: "2026-08-29T01:01:01.000Z",
    ingested_at: "2026-08-29T01:01:05.000Z",
    link_method: "BUSINESS_ENTITY",
    link_confidence: "STRONG",
    matched_entity_type: "ORDER",
    ...overrides,
  })
}

test("classifies an authoritative strong-key conversion after the horizon", () => {
  const result = lateConversionCandidate({
    instance,
    profile,
    projection: completedProjection(),
    events: [lateOrder()],
  })
  assert.equal(result.arrival.classification, "AFTER_HORIZON")
  assert.equal(result.conversionEvent.canonical_event_id, "can_order")
})

test("classifies an in-horizon conversion ingested after finalization", () => {
  const result = lateConversionCandidate({
    instance,
    profile,
    projection: completedProjection(),
    events: [lateOrder({
      occurred_at: "2026-08-29T01:00:59.000Z",
      ingested_at: "2026-08-29T01:01:11.000Z",
    })],
  })
  assert.equal(result.arrival.classification, "TOO_LATE_FOR_FINAL_COHORT")
})

test("rejects weak identity, correlation-only, and non-authoritative time", () => {
  for (const event of [
    lateOrder({ link_method: "SESSION_CONTEXT", link_confidence: "WEAK", matched_entity_type: "SESSION" }),
    lateOrder({ link_method: "DIRECT_CORRELATION", matched_entity_type: "CORRELATION" }),
    lateOrder({
      occurred_at: "2026-08-29T01:01:01.000Z",
      ingested_at: "2026-08-29T01:01:05.000Z",
      quality: { time_basis: "ingress_fallback", authoritative_event_time: false },
    }),
  ]) {
    assert.equal(lateConversionCandidate({
      instance,
      profile,
      projection: completedProjection(),
      events: [event],
    }), null)
  }
})

test("does not reclassify a funnel that was not finalized as dropped", () => {
  assert.equal(lateConversionCandidate({
    instance: { ...instance, outcome_status: "IN_PROGRESS" },
    profile,
    projection: completedProjection(),
    events: [lateOrder()],
  }), null)
})
