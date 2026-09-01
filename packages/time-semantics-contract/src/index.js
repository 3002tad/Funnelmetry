export const TIME_SEMANTICS_SPEC_VERSION = "time-semantics.v1"

export const FUNNEL_MATURITY_STATES = Object.freeze([
  "UNCONFIGURED",
  "PENDING",
  "SUSPECTED_DROPOFF",
  "MATURED",
])

export const EVENT_ARRIVAL_CLASSES = Object.freeze([
  "UNCONFIGURED",
  "NON_AUTHORITATIVE_TIME",
  "CLOCK_SKEW_UNRESOLVED",
  "BEFORE_ENTRY",
  "ON_TIME",
  "LATE_ARRIVAL_WITHIN_GRACE",
  "TOO_LATE_FOR_FINAL_COHORT",
  "AFTER_HORIZON",
])

const TIME_BASES = new Set(["source_occurred", "source_produced", "ingress_fallback"])

function plainObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value
}

function optionalPositiveInteger(value, field, { allowZero = false } = {}) {
  if (value === undefined || value === null) return null
  const minimum = allowZero ? 0 : 1
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new Error(`${field} must be ${allowZero ? "a non-negative" : "a positive"} integer`)
  }
  return value
}

function timestamp(value, field) {
  if (typeof value !== "string" || !value.trim() || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be an ISO-8601 timestamp`)
  }
  return value
}

function addSeconds(timestampValue, seconds, field) {
  const milliseconds = Date.parse(timestampValue) + seconds * 1000
  const result = new Date(milliseconds)
  if (!Number.isFinite(milliseconds) || Number.isNaN(result.getTime())) {
    throw new Error(`${field} is outside the supported timestamp range`)
  }
  return result.toISOString()
}

export function validateFunnelTimePolicy(input) {
  const value = plainObject(input, "funnel time policy")
  const conversionHorizon = optionalPositiveInteger(
    value.conversion_horizon_seconds,
    "conversion_horizon_seconds",
  )
  const lateArrivalGrace = optionalPositiveInteger(
    value.late_arrival_grace_seconds,
    "late_arrival_grace_seconds",
    { allowZero: true },
  )
  if ((conversionHorizon === null) !== (lateArrivalGrace === null)) {
    throw new Error("conversion_horizon_seconds and late_arrival_grace_seconds must be configured together")
  }
  const sessionInactivity = optionalPositiveInteger(
    value.session_inactivity_timeout_seconds,
    "session_inactivity_timeout_seconds",
  )
  const transitionInput = value.transition_timeouts_seconds ?? {}
  plainObject(transitionInput, "transition_timeouts_seconds")
  const transitionTimeouts = {}
  for (const [stepId, timeout] of Object.entries(transitionInput)) {
    if (!stepId.trim()) throw new Error("transition timeout step id must be non-empty")
    if (stepId !== stepId.trim()) throw new Error("transition timeout step id must not contain surrounding whitespace")
    const normalizedTimeout = optionalPositiveInteger(timeout, `transition_timeouts_seconds.${stepId}`)
    if (normalizedTimeout === null) throw new Error(`transition_timeouts_seconds.${stepId} must be a positive integer`)
    transitionTimeouts[stepId] = normalizedTimeout
  }
  return Object.freeze({
    spec_version: TIME_SEMANTICS_SPEC_VERSION,
    configured: conversionHorizon !== null,
    conversion_horizon_seconds: conversionHorizon,
    late_arrival_grace_seconds: lateArrivalGrace,
    session_inactivity_timeout_seconds: sessionInactivity,
    transition_timeouts_seconds: Object.freeze(transitionTimeouts),
  })
}

export function calculateFunnelTimeBounds({ entry_at: entryAt, policy: policyInput } = {}) {
  const entry = timestamp(entryAt, "entry_at")
  const policy = validateFunnelTimePolicy(policyInput)
  if (!policy.configured) {
    return Object.freeze({ configured: false, entry_at: entry, conversion_deadline: null, finalization_at: null })
  }
  const conversionDeadline = addSeconds(entry, policy.conversion_horizon_seconds, "conversion_deadline")
  const finalizationAt = addSeconds(conversionDeadline, policy.late_arrival_grace_seconds, "finalization_at")
  return Object.freeze({
    configured: true,
    entry_at: entry,
    conversion_deadline: conversionDeadline,
    finalization_at: finalizationAt,
  })
}

export function classifyFunnelMaturity({
  entry_at: entryAt,
  observed_at: observedAt,
  last_reached_at: lastReachedAt,
  next_step_id: nextStepId,
  policy: policyInput,
} = {}) {
  const observed = timestamp(observedAt, "observed_at")
  const bounds = calculateFunnelTimeBounds({ entry_at: entryAt, policy: policyInput })
  const policy = validateFunnelTimePolicy(policyInput)
  if (!bounds.configured) return Object.freeze({ state: "UNCONFIGURED", ...bounds })
  if (Date.parse(observed) > Date.parse(bounds.finalization_at)) {
    return Object.freeze({ state: "MATURED", ...bounds })
  }
  if (nextStepId !== undefined) {
    if (typeof nextStepId !== "string" || !nextStepId.trim()) throw new Error("next_step_id must be a non-empty string")
    const transitionTimeout = policy.transition_timeouts_seconds[nextStepId]
    if (transitionTimeout !== undefined && lastReachedAt !== undefined) {
      const lastReached = timestamp(lastReachedAt, "last_reached_at")
      const suspectedAt = addSeconds(lastReached, transitionTimeout, "suspected_dropoff_at")
      if (Date.parse(observed) >= Date.parse(suspectedAt)) {
        return Object.freeze({ state: "SUSPECTED_DROPOFF", suspected_dropoff_at: suspectedAt, ...bounds })
      }
    }
  }
  return Object.freeze({ state: "PENDING", ...bounds })
}

export function classifyCanonicalEventArrival({
  entry_at: entryAt,
  occurred_at: occurredAt,
  ingested_at: ingestedAt,
  time_basis: timeBasis,
  policy: policyInput,
} = {}) {
  const occurred = timestamp(occurredAt, "occurred_at")
  const ingested = timestamp(ingestedAt, "ingested_at")
  if (!TIME_BASES.has(timeBasis)) throw new Error("time_basis is unsupported")
  const bounds = calculateFunnelTimeBounds({ entry_at: entryAt, policy: policyInput })
  if (!bounds.configured) return Object.freeze({ classification: "UNCONFIGURED", ...bounds })
  if (timeBasis !== "source_occurred") {
    return Object.freeze({ classification: "NON_AUTHORITATIVE_TIME", ...bounds })
  }
  const occurredMs = Date.parse(occurred)
  const ingestedMs = Date.parse(ingested)
  const entryMs = Date.parse(bounds.entry_at)
  const deadlineMs = Date.parse(bounds.conversion_deadline)
  const finalizationMs = Date.parse(bounds.finalization_at)
  if (ingestedMs < occurredMs) return Object.freeze({ classification: "CLOCK_SKEW_UNRESOLVED", ...bounds })
  if (occurredMs < entryMs) return Object.freeze({ classification: "BEFORE_ENTRY", ...bounds })
  if (occurredMs > deadlineMs) return Object.freeze({ classification: "AFTER_HORIZON", ...bounds })
  if (ingestedMs <= deadlineMs) return Object.freeze({ classification: "ON_TIME", ...bounds })
  if (ingestedMs <= finalizationMs) {
    return Object.freeze({ classification: "LATE_ARRIVAL_WITHIN_GRACE", ...bounds })
  }
  return Object.freeze({ classification: "TOO_LATE_FOR_FINAL_COHORT", ...bounds })
}
