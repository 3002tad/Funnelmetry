import { validateFunnelTimePolicy } from "@funnelmetry/time-semantics-contract"

const EVENT_CLASSES = new Set(["BEHAVIOR_INTENT", "CLIENT_OBSERVATION", "BUSINESS_FACT"])

export function validateProfile(profile) {
  if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error("funnel profile must be an object")
  for (const field of ["funnel_profile_id", "profile_version", "display_name", "subject_scope", "entry_event_type"]) {
    if (typeof profile[field] !== "string" || profile[field].trim() === "") throw new Error(`${field} is required`)
  }
  if (!Array.isArray(profile.ordered_steps) || profile.ordered_steps.length === 0) {
    throw new Error("ordered_steps must contain at least one step")
  }
  const ids = new Set()
  profile.ordered_steps.forEach((step, index) => {
    if (!step || typeof step !== "object") throw new Error(`ordered_steps[${index}] must be an object`)
    if (typeof step.step_id !== "string" || !step.step_id) throw new Error(`ordered_steps[${index}].step_id is required`)
    if (ids.has(step.step_id)) throw new Error("funnel step ids must be unique")
    ids.add(step.step_id)
    if (typeof step.event_type !== "string" || !step.event_type) throw new Error(`ordered_steps[${index}].event_type is required`)
    if (!EVENT_CLASSES.has(step.event_class)) throw new Error(`ordered_steps[${index}].event_class is invalid`)
  })
  if (profile.ordered_steps[0].event_type !== profile.entry_event_type) {
    throw new Error("entry_event_type must match the first ordered step")
  }
  validateFunnelTimePolicy(profile)
  const negativeEvents = profile.negative_events ?? []
  if (!Array.isArray(negativeEvents) || negativeEvents.some((value) => typeof value !== "string" || !value)) {
    throw new Error("negative_events must be an array of event types")
  }
  return Object.freeze({ ...profile, ordered_steps: Object.freeze(profile.ordered_steps.map((step) => Object.freeze({ ...step }))), negative_events: Object.freeze([...negativeEvents]) })
}

function compareEvents(left, right) {
  return Date.parse(left.occurred_at) - Date.parse(right.occurred_at)
    || left.canonical_event_id.localeCompare(right.canonical_event_id)
}

export function evaluateFunnelWindow(profileInput, eventsInput) {
  const profile = validateProfile(profileInput)
  const events = [...eventsInput].sort(compareEvents)
  const reached = []
  const branches = []
  let expectedStep = 0

  for (const event of events) {
    if (profile.negative_events.includes(event.event_type)) {
      branches.push(Object.freeze({
        canonical_event_id: event.canonical_event_id,
        event_type: event.event_type,
        occurred_at: event.occurred_at,
        branch_kind: "NEGATIVE_EVENT",
      }))
    }

    const matchingIndex = profile.ordered_steps.findIndex(
      (step) => step.event_type === event.event_type && step.event_class === event.event_class,
    )
    if (matchingIndex < 0 || matchingIndex > expectedStep) continue
    if (matchingIndex < expectedStep) {
      const previous = reached[matchingIndex]
      previous.last_reached_at = event.occurred_at
      previous.occurrence_count += 1
      continue
    }
    const step = profile.ordered_steps[matchingIndex]
    reached.push({
      step_index: matchingIndex,
      step_id: step.step_id,
      event_type: step.event_type,
      representative_event_id: event.canonical_event_id,
      first_reached_at: event.occurred_at,
      last_reached_at: event.occurred_at,
      occurrence_count: 1,
      sequence_status: "IN_ORDER",
    })
    expectedStep += 1
  }

  const converted = expectedStep === profile.ordered_steps.length
  return Object.freeze({
    outcome_status: converted ? "CONVERTED" : "IN_PROGRESS",
    converted_at: converted ? reached.at(-1).first_reached_at : null,
    steps: Object.freeze(reached.map((step) => Object.freeze({ ...step }))),
    branches: Object.freeze(branches),
  })
}
