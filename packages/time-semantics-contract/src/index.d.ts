export const TIME_SEMANTICS_SPEC_VERSION: "time-semantics.v1"
export const FUNNEL_MATURITY_STATES: readonly ["UNCONFIGURED", "PENDING", "SUSPECTED_DROPOFF", "MATURED"]
export const EVENT_ARRIVAL_CLASSES: readonly [
  "UNCONFIGURED", "NON_AUTHORITATIVE_TIME", "CLOCK_SKEW_UNRESOLVED", "BEFORE_ENTRY", "ON_TIME",
  "LATE_ARRIVAL_WITHIN_GRACE", "TOO_LATE_FOR_FINAL_COHORT", "AFTER_HORIZON",
]

export type FunnelMaturityState = (typeof FUNNEL_MATURITY_STATES)[number]
export type EventArrivalClass = (typeof EVENT_ARRIVAL_CLASSES)[number]

export interface FunnelTimePolicyInput {
  conversion_horizon_seconds?: number | null
  late_arrival_grace_seconds?: number | null
  session_inactivity_timeout_seconds?: number | null
  transition_timeouts_seconds?: Record<string, number>
}

export interface FunnelTimePolicy {
  spec_version: "time-semantics.v1"
  configured: boolean
  conversion_horizon_seconds: number | null
  late_arrival_grace_seconds: number | null
  session_inactivity_timeout_seconds: number | null
  transition_timeouts_seconds: Readonly<Record<string, number>>
}

export interface FunnelTimeBounds {
  configured: boolean
  entry_at: string
  conversion_deadline: string | null
  finalization_at: string | null
}

export function validateFunnelTimePolicy(input: unknown): Readonly<FunnelTimePolicy>
export function calculateFunnelTimeBounds(input: {
  entry_at: string
  policy: FunnelTimePolicyInput
}): Readonly<FunnelTimeBounds>
export function classifyFunnelMaturity(input: {
  entry_at: string
  observed_at: string
  last_reached_at?: string
  next_step_id?: string
  policy: FunnelTimePolicyInput
}): Readonly<FunnelTimeBounds & { state: FunnelMaturityState; suspected_dropoff_at?: string }>
export function classifyCanonicalEventArrival(input: {
  entry_at: string
  occurred_at: string
  ingested_at: string
  time_basis: "source_occurred" | "source_produced" | "ingress_fallback"
  policy: FunnelTimePolicyInput
}): Readonly<FunnelTimeBounds & { classification: EventArrivalClass }>
