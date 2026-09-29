import test from 'node:test'
import assert from 'node:assert/strict'
import { evaluateFunnelWindow } from '../src/evaluator.js'
import { REFERENCE_FUNNEL_PROFILES } from '../src/reference-profiles.js'

test('Medusa reference v2 converts on placement only, not created/accepted/payment aliases', () => {
  const profile = REFERENCE_FUNNEL_PROFILES[0]
  assert.equal(profile.profile_version, '2.0.0')
  const events = profile.ordered_steps.map((step, index) => ({ canonical_event_id: `can_${index}`, event_type: step.event_type, event_class: step.event_class, occurred_at: `2026-09-22T12:00:0${index}.000Z` }))
  assert.equal(evaluateFunnelWindow(profile, events).outcome_status, 'CONVERTED')
  for (const event_type of ['order.created', 'order.accepted', 'payment.captured']) {
    assert.equal(evaluateFunnelWindow(profile, [...events.slice(0, 3), { ...events[3], event_type }]).outcome_status, 'IN_PROGRESS')
  }
})
