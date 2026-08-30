export const CANONICAL_EVENT_SPEC_VERSION: "canonical-event.v1"
export const CANONICAL_EVENT_CLASSES: readonly ["BEHAVIOR_INTENT", "CLIENT_OBSERVATION", "BUSINESS_FACT"]
export const CANONICALIZATION_STATUSES: readonly ["normalized", "unsupported", "quarantined"]
export const TIME_BASES: readonly ["source_occurred", "source_produced", "ingress_fallback"]

export type CanonicalEventClass = (typeof CANONICAL_EVENT_CLASSES)[number]
export type CanonicalizationStatus = (typeof CANONICALIZATION_STATUSES)[number]
export type TimeBasis = (typeof TIME_BASES)[number]

export interface CanonicalEvent {
  canonical_event_id: string
  source_event_id: string
  event_type: string
  event_class: CanonicalEventClass
  canonical_schema_version: "canonical-event.v1"
  mapping_version: string
  occurred_at: string
  produced_at?: string
  ingested_at: string
  normalized_at: string
  source_id: string
  aggregate?: { type: string; id: string; version?: string }
  relations?: Record<string, unknown>
  identity?: Record<string, unknown>
  data: Record<string, unknown>
  quality: Record<string, unknown> & { time_basis: TimeBasis; authoritative_event_time: boolean }
  source_reference: { raw_record_id: string; content_hash: string; byte_size: number }
}

export interface CanonicalizationOutcome {
  source_id: string
  source_event_id: string
  status: CanonicalizationStatus
  mapping_version: string
  processed_at: string
  raw_record_id: string
  canonical_event_id?: string
  reason_code?: string
}

export function validateCanonicalEvent(input: unknown): Readonly<CanonicalEvent>
export function validateCanonicalizationOutcome(input: unknown): Readonly<CanonicalizationOutcome>
