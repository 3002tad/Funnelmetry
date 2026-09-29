import test from "node:test"
import assert from "node:assert/strict"
import { evaluateFunnelWindow, validateProfile } from "../src/evaluator.js"
import { commerceProfile } from "./fixtures.js"
import { REFERENCE_FUNNEL_PROFILES } from "../src/reference-profiles.js"

function event(id, type, eventClass, second) {
  return { canonical_event_id: id, event_type: type, event_class: eventClass, occurred_at: `2026-08-29T01:00:${String(second).padStart(2, "0")}.000Z` }
}

test("converts only after every ordered step is reached with the required authority", () => {
  const result = evaluateFunnelWindow(commerceProfile, [
    event("can_4", "order.accepted", "BUSINESS_FACT", 4),
    event("can_2", "cart.item_added", "BUSINESS_FACT", 2),
    event("can_1", "behavior.product_viewed", "BEHAVIOR_INTENT", 1),
    event("can_3", "checkout.started", "BEHAVIOR_INTENT", 3),
  ])
  assert.equal(result.outcome_status, "CONVERTED")
  assert.equal(result.converted_at, "2026-08-29T01:00:04.000Z")
  assert.deepEqual(result.steps.map((step) => step.step_id), ["view", "cart", "checkout", "order"])
})

test("does not count a business fact claimed with browser authority", () => {
  const result = evaluateFunnelWindow(commerceProfile, [
    event("can_1", "behavior.product_viewed", "BEHAVIOR_INTENT", 1),
    event("can_2", "cart.item_added", "BEHAVIOR_INTENT", 2),
  ])
  assert.equal(result.outcome_status, "IN_PROGRESS")
  assert.equal(result.steps.length, 1)
})

test("reorders late delivery by event time and uses canonical id as a stable tie breaker", () => {
  const result = evaluateFunnelWindow(commerceProfile, [
    event("can_2", "cart.item_added", "BUSINESS_FACT", 2),
    event("can_1", "behavior.product_viewed", "BEHAVIOR_INTENT", 1),
  ])
  assert.deepEqual(result.steps.map((step) => step.step_id), ["view", "cart"])
})

test("keeps negative events as branches without undoing conversion", () => {
  const events = [
    event("can_1", "behavior.product_viewed", "BEHAVIOR_INTENT", 1),
    event("can_2", "cart.item_added", "BUSINESS_FACT", 2),
    event("can_3", "checkout.started", "BEHAVIOR_INTENT", 3),
    event("can_4", "order.accepted", "BUSINESS_FACT", 4),
    event("can_5", "order.cancelled", "BUSINESS_FACT", 5),
  ]
  const result = evaluateFunnelWindow(commerceProfile, events)
  assert.equal(result.outcome_status, "CONVERTED")
  assert.deepEqual(result.branches.map((branch) => branch.event_type), ["order.cancelled"])
})

test("requires the entry event to be the first profile step", () => {
  assert.throws(() => validateProfile({ ...commerceProfile, entry_event_type: "checkout.started" }), /first ordered step/)
})

test("rejects a partially configured time policy", () => {
  assert.throws(
    () => validateProfile({ ...commerceProfile, conversion_horizon_seconds: 3600 }),
    /must be configured together/,
  )
})

test("requires transition timeouts to target a non-entry profile step", () => {
  assert.throws(
    () => validateProfile({ ...commerceProfile, transition_timeouts_seconds: { missing: 60 } }),
    /unknown step/,
  )
  assert.throws(
    () => validateProfile({ ...commerceProfile, transition_timeouts_seconds: { view: 60 } }),
    /after the entry step/,
  )
})

test("ships only the two approved reference semantics without invented timeout values", () => {
  assert.deepEqual(REFERENCE_FUNNEL_PROFILES.map((profile) => profile.ordered_steps.map((step) => step.event_type)), [
    ["behavior.product_viewed", "cart.item_added", "checkout.started", "order.placed"],
    ["order.created", "payment.attempted", "payment.captured"],
  ])
  for (const profile of REFERENCE_FUNNEL_PROFILES) {
    assert.equal(validateProfile(profile).conversion_horizon_seconds, null)
  }
})
