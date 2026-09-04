export const RECONCILIATION_MANIFEST_SPEC_VERSION: "reconciliation-manifest.v1"
export const RECONCILIATION_MODES: readonly ["RECORD_LEVEL", "AGGREGATE_ONLY"]
export const RECONCILIATION_WINDOW_STATES: readonly ["PROVISIONAL", "RECONCILING", "RECONCILED", "DEGRADED"]
export const RECONCILIATION_DISCREPANCY_KINDS: readonly [
  "MISSING",
  "PHANTOM",
  "STATE_MISMATCH",
  "AMOUNT_MISMATCH",
]
export const RECONCILIATION_LIMITATION_REASONS: readonly [
  "SNAPSHOT_NOT_CLOSED",
  "SNAPSHOT_INCOMPLETE",
  "AGGREGATE_ONLY",
]

export type ReconciliationMode = (typeof RECONCILIATION_MODES)[number]
export type ReconciliationWindowState = (typeof RECONCILIATION_WINDOW_STATES)[number]
export type ReconciliationLimitationReason = (typeof RECONCILIATION_LIMITATION_REASONS)[number]
export type ReconciliationDiscrepancyKind = (typeof RECONCILIATION_DISCREPANCY_KINDS)[number]

export interface ReconciliationHash {
  algorithm: "sha256"
  value: string
  field_set: string[]
}

export interface ReconciliationMoney {
  currency: string
  amount: string
}

export interface ReconciliationRecord {
  entity_id: string
  current_status: string
  version?: string
  updated_at?: string
  occurred_at?: string
  committed_at?: string
  money?: ReconciliationMoney
  tombstone: boolean
  record_hash?: ReconciliationHash
}

export interface ReconciliationManifest {
  reconciliation_schema_version: "reconciliation-manifest.v1"
  snapshot_id: string
  source_id: string
  entity_type: string
  mode: ReconciliationMode
  as_of: string
  coverage: {
    start_at: string
    end_at: string
    timezone: string
    scope: Record<string, unknown>
  }
  closed: boolean
  complete: boolean
  closed_at: string | null
  watermark: { at: string; grace_period_seconds: number }
  source_schema_version: string
  semantic_version: string
  records: ReconciliationRecord[]
  control_totals: {
    record_count: number
    amounts: ReconciliationMoney[]
    control_hash?: ReconciliationHash
  }
}

export interface ReconciliationCapabilityAssessment {
  window_state: ReconciliationWindowState
  limitation_reason: ReconciliationLimitationReason | null
  aggregate_comparison_allowed: boolean
  record_level_comparison_allowed: boolean
  record_level_repair_allowed: boolean
}

export interface ReconciliationAnalyticsProjection {
  source_id: string
  entity_type: string
  as_of: string
  coverage: ReconciliationManifest["coverage"]
  records: ReconciliationRecord[]
  control_totals: ReconciliationManifest["control_totals"]
}

export interface ReconciliationDiscrepancy {
  kind: ReconciliationDiscrepancyKind
  entity_id: string
  source_record: ReconciliationRecord | null
  analytics_record: ReconciliationRecord | null
}

export interface ReconciliationComparison {
  source_id: string
  snapshot_id: string
  entity_type: string
  source_as_of: string
  analytics_as_of: string
  window_state: "RECONCILING" | "RECONCILED" | "DEGRADED"
  limitation_reason: ReconciliationLimitationReason | null
  record_level_metrics_available: boolean
  source_count: number
  analytics_count: number
  source_denominator_empty: boolean
  analytics_denominator_empty: boolean
  control_total_mismatch: boolean
  missing_count: number | null
  phantom_count: number | null
  state_mismatch_count: number | null
  amount_mismatch_count: number | null
  missing_rate: number | null
  phantom_rate: number | null
  state_mismatch_rate: number | null
  amount_mismatch_rate: number | null
  revenue_deviation: Array<{
    currency: string
    source_amount: string
    analytics_amount: string
    absolute_deviation: string
    deviation_rate: string | null
    denominator_empty: boolean
  }>
  analytics_projection: ReconciliationAnalyticsProjection
  discrepancies: ReconciliationDiscrepancy[]
  evidence_hash: string
}

export function validateReconciliationManifest(input: unknown): Readonly<ReconciliationManifest>
export function assessReconciliationCapability(input: unknown): Readonly<ReconciliationCapabilityAssessment>
export function hashReconciliationManifest(input: unknown): string
export function validateReconciliationAnalyticsProjection(
  input: unknown,
): Readonly<ReconciliationAnalyticsProjection>
export function hashReconciliationAnalyticsProjection(input: unknown): string
export function hashReconciliationCoverage(input: {
  source_id: unknown
  entity_type: unknown
  as_of: unknown
  coverage: unknown
}): string
export function compareReconciliationEvidence(input: {
  manifest: unknown
  analytics_projection: unknown
}): Readonly<ReconciliationComparison>
