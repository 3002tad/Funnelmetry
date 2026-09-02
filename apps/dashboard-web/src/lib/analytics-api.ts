import { analyticsSourceId, apiRequest } from "./api"

export type QualityStatus = "PROVISIONAL" | "RECONCILING" | "RECONCILED" | "DEGRADED"
export type OutcomeStatus = "IN_PROGRESS" | "CONVERTED" | "DROPPED" | "TERMINATED" | "INVALID"

export type ProfileTotal = {
  funnel_profile_id: string
  profile_version: string
  display_name: string
  entrants: number
  observed_converted: number
  pending: number
  dropped: number
  terminated: number
  invalid: number
  eligible_matured: number
  matured_converted: number
  finalized_dropped: number
  late_conversions: number
  too_late_for_final_cohort: number
  after_horizon: number
  late_conversion_rate: number | null
  final_end_to_end_rate: number | null
  final_dropoff_rate: number | null
  provisional: number
  reconciling: number
  reconciled: number
  degraded: number
  observed_end_to_end_rate: number | null
  first_entry_at: string | null
  last_entry_at: string | null
}

export type LateConversionSummary = {
  late_conversion_id: string
  conversion_event_id: string
  arrival_class: "TOO_LATE_FOR_FINAL_COHORT" | "AFTER_HORIZON"
  conversion_occurred_at: string
  conversion_ingested_at: string
  link_method: string
  link_confidence: "STRONG"
  matched_entity_type: "CART" | "CHECKOUT" | "ORDER" | "PAYMENT"
  detected_at: string
}

export type OverviewResponse = {
  source_id: string
  cohort: { basis: "entry_at"; from: string | null; to: string | null }
  metric_state: "OBSERVED"
  profiles: ProfileTotal[]
}

export type FunnelResponse = {
  source_id: string
  cohort: OverviewResponse["cohort"]
  metric_state: "OBSERVED"
  profile: {
    funnel_profile_id: string
    profile_version: string
    display_name: string
    subject_scope: string
    entry_event_type: string
    conversion_horizon_seconds: number | null
    late_arrival_grace_seconds: number | null
    published_at: string
  }
  totals: ProfileTotal
  steps: Array<{
    step_index: number
    step_id: string
    event_type: string
    event_class: string
    entrants: number
    reached: number
    observed_reach_rate: number | null
  }>
}

export type JourneyListItem = {
  journey_id: string
  status: string
  first_event_at: string
  last_event_at: string
  event_count: number
  entity_type_count: number
  funnel_instances: Array<{
    funnel_instance_id: string
    funnel_profile_id: string
    profile_version: string
    outcome_status: OutcomeStatus
    quality_status: QualityStatus
    entry_at: string
    converted_at: string | null
    has_late_conversion: boolean
  }>
}

export type JourneyDetail = {
  journey_id: string
  source_id: string
  status: string
  first_event_at: string
  last_event_at: string
  event_count: number
  events: Array<{
    canonical_event_id: string
    event_type: string
    event_class: string
    occurred_at: string
    quality: { time_basis?: string; authoritative_event_time?: boolean }
    link_method: string
    link_confidence: string
  }>
  evidence_summary: Array<{
    entity_type: string
    link_method: string
    link_confidence: string
    evidence_count: number
  }>
  funnel_instances: Array<{
    funnel_instance_id: string
    funnel_profile_id: string
    profile_version: string
    outcome_status: OutcomeStatus
    quality_status: QualityStatus
    entry_at: string
    converted_at: string | null
    late_conversion: LateConversionSummary | null
    steps: Array<{ step_index: number; step_id: string; event_type: string; sequence_status: string }>
  }>
}

export type CanonicalEventItem = {
  canonical_event_id: string
  event_type: string
  event_class: "BEHAVIOR_INTENT" | "CLIENT_OBSERVATION" | "BUSINESS_FACT"
  occurred_at: string
  produced_at: string | null
  ingested_at: string
  normalized_at: string
  persisted_at: string
  canonical_schema_version: string
  mapping_version: string
  aggregate_type: string | null
  time_basis: "source_occurred" | "source_produced" | "ingress_fallback"
  authoritative_event_time: boolean
  journey_id: string | null
  link_method: string | null
  link_confidence: string | null
}

export type DataHealthResponse = {
  source_id: string
  observation_window: { basis: "persisted_at"; from: string | null; to: string | null }
  ingress_window: { basis: "received_at"; from: string | null; to: string | null }
  projection_window: { basis: "entry_at"; from: string | null; to: string | null }
  canonicalization: {
    accepted_events: number
    terminal_outcomes: number
    terminal_outcome_rate: number | null
    normalized: number
    unsupported: number
    quarantined: number
    canonicalization_latency_p50_ms: number | null
    canonicalization_latency_p95_ms: number | null
    first_received_at: string | null
    last_received_at: string | null
    last_processed_at: string | null
  }
  canonical: {
    events: number
    behavior_intent: number
    client_observation: number
    business_fact: number
    authoritative_event_time: number
    authoritative_event_time_rate: number | null
    source_produced_time: number
    ingress_fallback_time: number
    normalization_latency_p50_ms: number | null
    normalization_latency_p95_ms: number | null
    canonical_persistence_latency_p95_ms: number | null
    first_persisted_at: string | null
    last_persisted_at: string | null
  }
  hourly: Array<{ bucket_start: string; canonical_events: number; non_authoritative_time: number }>
  projection_quality: {
    funnel_instances: number
    provisional: number
    reconciling: number
    reconciled: number
    degraded: number
  }
  unavailable_metrics: string[]
}

function cohortFromRange(range: string) {
  const days = range === "Last 7 days" ? 7 : range === "Last 90 days" ? 90 : 30
  return new Date(Date.now() - days * 86_400_000).toISOString()
}

function scopeParams(range?: string) {
  const params = new URLSearchParams({ source_id: analyticsSourceId })
  if (range) params.set("from", cohortFromRange(range))
  return params
}

export function fetchV2Overview(range: string) {
  return apiRequest<OverviewResponse>(`/api/v2/analytics/overview?${scopeParams(range)}`)
}

export function fetchV2Funnel(profileId: string, version: string, range: string) {
  const params = scopeParams(range)
  params.set("profile_version", version)
  return apiRequest<FunnelResponse>(`/api/v2/analytics/funnels/${encodeURIComponent(profileId)}?${params}`)
}

export async function fetchV2Journeys(limit = 50) {
  const params = scopeParams()
  params.set("limit", String(limit))
  const response = await apiRequest<{ source_id: string; limit: number; journeys: JourneyListItem[] }>(
    `/api/v2/analytics/journeys?${params}`,
  )
  return response.journeys
}

export function fetchV2Journey(journeyId: string) {
  return apiRequest<JourneyDetail>(
    `/api/v2/analytics/journeys/${encodeURIComponent(journeyId)}?${scopeParams()}`,
  )
}

export async function fetchV2Events(range: string, eventClass?: string) {
  const params = scopeParams(range)
  params.set("limit", "200")
  if (eventClass) params.set("event_class", eventClass)
  const response = await apiRequest<{
    source_id: string
    window: { basis: "occurred_at"; from: string | null; to: string | null }
    limit: number
    events: CanonicalEventItem[]
  }>(`/api/v2/analytics/events?${params}`)
  return response.events
}

export function fetchV2DataHealth(range: string) {
  return apiRequest<DataHealthResponse>(`/api/v2/analytics/data-health?${scopeParams(range)}`)
}
