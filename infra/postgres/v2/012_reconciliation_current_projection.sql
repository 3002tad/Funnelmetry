BEGIN;

CREATE TABLE IF NOT EXISTS analytics_current_projection_revisions (
  projection_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  coverage_key CHAR(64) NOT NULL CHECK (coverage_key ~ '^[a-f0-9]{64}$'),
  projection_revision BIGINT NOT NULL CHECK (projection_revision > 0),
  as_of TIMESTAMPTZ NOT NULL,
  coverage_start_at TIMESTAMPTZ NOT NULL,
  coverage_end_at TIMESTAMPTZ NOT NULL,
  coverage_timezone TEXT NOT NULL,
  coverage_scope JSONB NOT NULL CHECK (jsonb_typeof(coverage_scope) = 'object'),
  origin TEXT NOT NULL CHECK (origin IN ('PIPELINE', 'RECONCILIATION_CORRECTION')),
  comparison_id TEXT REFERENCES reconciliation_comparisons(comparison_id),
  record_count BIGINT NOT NULL CHECK (record_count >= 0),
  control_totals JSONB NOT NULL CHECK (jsonb_typeof(control_totals) = 'object'),
  projection_hash CHAR(64) NOT NULL CHECK (projection_hash ~ '^[a-f0-9]{64}$'),
  projection_document JSONB NOT NULL CHECK (jsonb_typeof(projection_document) = 'object'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, entity_type, coverage_key, projection_revision),
  UNIQUE (source_id, entity_type, coverage_key, projection_id, projection_revision),
  CHECK (coverage_start_at < coverage_end_at),
  CHECK (coverage_end_at <= as_of),
  CHECK (
    (origin = 'PIPELINE' AND comparison_id IS NULL)
    OR (origin = 'RECONCILIATION_CORRECTION' AND comparison_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS analytics_current_projection_records (
  projection_id TEXT NOT NULL REFERENCES analytics_current_projection_revisions(projection_id),
  entity_id TEXT NOT NULL,
  current_status TEXT NOT NULL,
  entity_version TEXT,
  analytics_updated_at TIMESTAMPTZ,
  analytics_occurred_at TIMESTAMPTZ,
  analytics_committed_at TIMESTAMPTZ,
  tombstone BOOLEAN NOT NULL,
  amount NUMERIC,
  currency CHAR(3),
  record_document JSONB NOT NULL CHECK (jsonb_typeof(record_document) = 'object'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (projection_id, entity_id),
  CHECK (entity_version IS NOT NULL OR analytics_updated_at IS NOT NULL),
  CHECK ((amount IS NULL) = (currency IS NULL))
);

CREATE TABLE IF NOT EXISTS analytics_current_projection_heads (
  source_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  coverage_key CHAR(64) NOT NULL CHECK (coverage_key ~ '^[a-f0-9]{64}$'),
  projection_id TEXT NOT NULL REFERENCES analytics_current_projection_revisions(projection_id),
  projection_revision BIGINT NOT NULL CHECK (projection_revision > 0),
  advanced_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, entity_type, coverage_key),
  UNIQUE (projection_id),
  FOREIGN KEY (source_id, entity_type, coverage_key, projection_id, projection_revision)
    REFERENCES analytics_current_projection_revisions(
      source_id, entity_type, coverage_key, projection_id, projection_revision
    )
);

CREATE TABLE IF NOT EXISTS reconciliation_repairs (
  repair_id TEXT PRIMARY KEY,
  comparison_id TEXT NOT NULL UNIQUE REFERENCES reconciliation_comparisons(comparison_id),
  source_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  before_projection_id TEXT NOT NULL REFERENCES analytics_current_projection_revisions(projection_id),
  after_projection_id TEXT NOT NULL UNIQUE REFERENCES analytics_current_projection_revisions(projection_id),
  repaired_at TIMESTAMPTZ NOT NULL,
  correction_count BIGINT NOT NULL CHECK (correction_count >= 0),
  repair_hash CHAR(64) NOT NULL CHECK (repair_hash ~ '^[a-f0-9]{64}$'),
  repair_document JSONB NOT NULL CHECK (jsonb_typeof(repair_document) = 'object'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  FOREIGN KEY (source_id, snapshot_id)
    REFERENCES reconciliation_snapshots(source_id, snapshot_id)
);

CREATE TABLE IF NOT EXISTS reconciliation_corrections (
  repair_id TEXT NOT NULL REFERENCES reconciliation_repairs(repair_id),
  entity_id TEXT NOT NULL,
  correction_action TEXT NOT NULL CHECK (correction_action IN ('UPSERT', 'REMOVE')),
  discrepancy_kinds TEXT[] NOT NULL CHECK (cardinality(discrepancy_kinds) > 0),
  before_record JSONB CHECK (before_record IS NULL OR jsonb_typeof(before_record) = 'object'),
  after_record JSONB CHECK (after_record IS NULL OR jsonb_typeof(after_record) = 'object'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (repair_id, entity_id),
  CHECK (
    (correction_action = 'UPSERT' AND after_record IS NOT NULL)
    OR (correction_action = 'REMOVE' AND before_record IS NOT NULL AND after_record IS NULL)
  ),
  CHECK (discrepancy_kinds <@ ARRAY[
    'MISSING', 'PHANTOM', 'STATE_MISMATCH', 'AMOUNT_MISMATCH'
  ]::TEXT[])
);

CREATE TABLE IF NOT EXISTS reconciliation_repair_verifications (
  repair_id TEXT PRIMARY KEY REFERENCES reconciliation_repairs(repair_id),
  verification_comparison_id TEXT NOT NULL UNIQUE REFERENCES reconciliation_comparisons(comparison_id),
  verified_at TIMESTAMPTZ NOT NULL,
  attempted_correction_count BIGINT NOT NULL CHECK (attempted_correction_count >= 0),
  successful_correction_count BIGINT NOT NULL CHECK (successful_correction_count >= 0),
  denominator_empty BOOLEAN NOT NULL,
  repair_success_rate DOUBLE PRECISION
    CHECK (repair_success_rate IS NULL OR (repair_success_rate >= 0 AND repair_success_rate <= 1)),
  current_projection_converged BOOLEAN NOT NULL,
  verification_hash CHAR(64) NOT NULL CHECK (verification_hash ~ '^[a-f0-9]{64}$'),
  verification_document JSONB NOT NULL CHECK (jsonb_typeof(verification_document) = 'object'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (successful_correction_count <= attempted_correction_count),
  CHECK (denominator_empty = (attempted_correction_count = 0)),
  CHECK ((repair_success_rate IS NULL) = denominator_empty)
);

DROP TRIGGER IF EXISTS analytics_current_projection_revisions_immutable
  ON analytics_current_projection_revisions;
CREATE TRIGGER analytics_current_projection_revisions_immutable
BEFORE UPDATE OR DELETE ON analytics_current_projection_revisions
FOR EACH ROW EXECUTE FUNCTION reject_reconciliation_evidence_mutation();

DROP TRIGGER IF EXISTS analytics_current_projection_records_immutable
  ON analytics_current_projection_records;
CREATE TRIGGER analytics_current_projection_records_immutable
BEFORE UPDATE OR DELETE ON analytics_current_projection_records
FOR EACH ROW EXECUTE FUNCTION reject_reconciliation_evidence_mutation();

DROP TRIGGER IF EXISTS reconciliation_repairs_immutable ON reconciliation_repairs;
CREATE TRIGGER reconciliation_repairs_immutable
BEFORE UPDATE OR DELETE ON reconciliation_repairs
FOR EACH ROW EXECUTE FUNCTION reject_reconciliation_evidence_mutation();

DROP TRIGGER IF EXISTS reconciliation_corrections_immutable ON reconciliation_corrections;
CREATE TRIGGER reconciliation_corrections_immutable
BEFORE UPDATE OR DELETE ON reconciliation_corrections
FOR EACH ROW EXECUTE FUNCTION reject_reconciliation_evidence_mutation();

DROP TRIGGER IF EXISTS reconciliation_repair_verifications_immutable
  ON reconciliation_repair_verifications;
CREATE TRIGGER reconciliation_repair_verifications_immutable
BEFORE UPDATE OR DELETE ON reconciliation_repair_verifications
FOR EACH ROW EXECUTE FUNCTION reject_reconciliation_evidence_mutation();

CREATE INDEX IF NOT EXISTS analytics_projection_scope_idx
  ON analytics_current_projection_revisions
    (source_id, entity_type, coverage_key, projection_revision DESC);

CREATE INDEX IF NOT EXISTS reconciliation_repairs_snapshot_idx
  ON reconciliation_repairs (source_id, snapshot_id, repaired_at DESC);

CREATE INDEX IF NOT EXISTS reconciliation_repair_verifications_time_idx
  ON reconciliation_repair_verifications (verified_at DESC);

COMMIT;
