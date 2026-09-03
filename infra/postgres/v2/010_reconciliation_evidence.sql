BEGIN;

CREATE TABLE IF NOT EXISTS reconciliation_snapshots (
  source_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  reconciliation_mode TEXT NOT NULL
    CHECK (reconciliation_mode IN ('RECORD_LEVEL', 'AGGREGATE_ONLY')),
  as_of TIMESTAMPTZ NOT NULL,
  coverage_start_at TIMESTAMPTZ NOT NULL,
  coverage_end_at TIMESTAMPTZ NOT NULL,
  coverage_timezone TEXT NOT NULL,
  coverage_scope JSONB NOT NULL CHECK (jsonb_typeof(coverage_scope) = 'object'),
  closed BOOLEAN NOT NULL,
  complete BOOLEAN NOT NULL,
  closed_at TIMESTAMPTZ,
  watermark_at TIMESTAMPTZ NOT NULL,
  watermark_grace_seconds BIGINT NOT NULL CHECK (watermark_grace_seconds >= 0),
  source_schema_version TEXT NOT NULL,
  semantic_version TEXT NOT NULL,
  window_state TEXT NOT NULL
    CHECK (window_state IN ('PROVISIONAL', 'RECONCILING', 'DEGRADED')),
  limitation_reason TEXT
    CHECK (limitation_reason IS NULL OR limitation_reason IN (
      'SNAPSHOT_NOT_CLOSED', 'SNAPSHOT_INCOMPLETE', 'AGGREGATE_ONLY'
    )),
  aggregate_comparison_allowed BOOLEAN NOT NULL,
  record_level_comparison_allowed BOOLEAN NOT NULL,
  record_level_repair_allowed BOOLEAN NOT NULL,
  record_count BIGINT NOT NULL CHECK (record_count >= 0),
  control_totals JSONB NOT NULL CHECK (jsonb_typeof(control_totals) = 'object'),
  manifest_hash CHAR(64) NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  manifest_document JSONB NOT NULL CHECK (jsonb_typeof(manifest_document) = 'object'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, snapshot_id),
  CHECK (coverage_start_at < coverage_end_at),
  CHECK (coverage_end_at <= as_of),
  CHECK (watermark_at <= as_of),
  CHECK (closed = (closed_at IS NOT NULL)),
  CHECK (
    (window_state = 'PROVISIONAL'
      AND limitation_reason = 'SNAPSHOT_NOT_CLOSED'
      AND NOT closed
      AND NOT aggregate_comparison_allowed
      AND NOT record_level_comparison_allowed
      AND NOT record_level_repair_allowed)
    OR
    (window_state = 'RECONCILING'
      AND limitation_reason IS NULL
      AND closed AND complete AND reconciliation_mode = 'RECORD_LEVEL'
      AND aggregate_comparison_allowed
      AND record_level_comparison_allowed
      AND record_level_repair_allowed)
    OR
    (window_state = 'DEGRADED'
      AND limitation_reason IS NOT NULL
      AND closed
      AND aggregate_comparison_allowed
      AND NOT record_level_comparison_allowed
      AND NOT record_level_repair_allowed)
  )
);

CREATE TABLE IF NOT EXISTS reconciliation_snapshot_records (
  source_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  current_status TEXT NOT NULL,
  entity_version TEXT,
  source_updated_at TIMESTAMPTZ,
  source_occurred_at TIMESTAMPTZ,
  source_committed_at TIMESTAMPTZ,
  tombstone BOOLEAN NOT NULL,
  amount NUMERIC,
  currency CHAR(3),
  record_hash CHAR(64) CHECK (record_hash IS NULL OR record_hash ~ '^[a-f0-9]{64}$'),
  record_hash_metadata JSONB
    CHECK (record_hash_metadata IS NULL OR jsonb_typeof(record_hash_metadata) = 'object'),
  record_document JSONB NOT NULL CHECK (jsonb_typeof(record_document) = 'object'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, snapshot_id, entity_id),
  FOREIGN KEY (source_id, snapshot_id)
    REFERENCES reconciliation_snapshots(source_id, snapshot_id),
  CHECK (entity_version IS NOT NULL OR source_updated_at IS NOT NULL),
  CHECK ((amount IS NULL) = (currency IS NULL))
);

CREATE TABLE IF NOT EXISTS reconciliation_snapshot_amount_totals (
  source_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  currency CHAR(3) NOT NULL,
  amount NUMERIC NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, snapshot_id, currency),
  FOREIGN KEY (source_id, snapshot_id)
    REFERENCES reconciliation_snapshots(source_id, snapshot_id)
);

CREATE OR REPLACE FUNCTION reject_reconciliation_evidence_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS reconciliation_snapshots_immutable ON reconciliation_snapshots;
CREATE TRIGGER reconciliation_snapshots_immutable
BEFORE UPDATE OR DELETE ON reconciliation_snapshots
FOR EACH ROW EXECUTE FUNCTION reject_reconciliation_evidence_mutation();

DROP TRIGGER IF EXISTS reconciliation_snapshot_records_immutable ON reconciliation_snapshot_records;
CREATE TRIGGER reconciliation_snapshot_records_immutable
BEFORE UPDATE OR DELETE ON reconciliation_snapshot_records
FOR EACH ROW EXECUTE FUNCTION reject_reconciliation_evidence_mutation();

DROP TRIGGER IF EXISTS reconciliation_snapshot_amount_totals_immutable
  ON reconciliation_snapshot_amount_totals;
CREATE TRIGGER reconciliation_snapshot_amount_totals_immutable
BEFORE UPDATE OR DELETE ON reconciliation_snapshot_amount_totals
FOR EACH ROW EXECUTE FUNCTION reject_reconciliation_evidence_mutation();

CREATE INDEX IF NOT EXISTS reconciliation_snapshots_scope_idx
  ON reconciliation_snapshots (source_id, entity_type, coverage_end_at DESC);

CREATE INDEX IF NOT EXISTS reconciliation_snapshots_state_idx
  ON reconciliation_snapshots (source_id, window_state, recorded_at DESC);

COMMIT;
