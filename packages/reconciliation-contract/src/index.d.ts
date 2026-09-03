export const RECONCILIATION_MANIFEST_SPEC_VERSION: "reconciliation-manifest.v1"
export const RECONCILIATION_MODES: readonly ["RECORD_LEVEL", "AGGREGATE_ONLY"]
export const RECONCILIATION_WINDOW_STATES: readonly ["PROVISIONAL", "RECONCILING", "DEGRADED"]
export const RECONCILIATION_LIMITATION_REASONS: readonly [
  "SNAPSHOT_NOT_CLOSED",
  "SNAPSHOT_INCOMPLETE",
  "AGGREGATE_ONLY",
]

export type ReconciliationMode = (typeof RECONCILIATION_MODES)[number]
export type ReconciliationWindowState = (typeof RECONCILIATION_WINDOW_STATES)[number]
export type ReconciliationLimitationReason = (typeof RECONCILIATION_LIMITATION_REASONS)[number]

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

export function validateReconciliationManifest(input: unknown): Readonly<ReconciliationManifest>
export function assessReconciliationCapability(input: unknown): Readonly<ReconciliationCapabilityAssessment>
export function hashReconciliationManifest(input: unknown): string
