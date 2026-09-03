BEGIN;

CREATE TABLE IF NOT EXISTS reconciliation_comparisons (
  comparison_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  comparison_revision BIGINT NOT NULL CHECK (comparison_revision > 0),
  observed_at TIMESTAMPTZ NOT NULL,
  analytics_as_of TIMESTAMPTZ NOT NULL,
  window_state TEXT NOT NULL CHECK (window_state IN ('RECONCILING', 'RECONCILED', 'DEGRADED')),
  limitation_reason TEXT
    CHECK (limitation_reason IS NULL OR limitation_reason IN ('SNAPSHOT_INCOMPLETE', 'AGGREGATE_ONLY')),
  record_level_metrics_available BOOLEAN NOT NULL,
  source_count BIGINT NOT NULL CHECK (source_count >= 0),
  analytics_count BIGINT NOT NULL CHECK (analytics_count >= 0),
  source_denominator_empty BOOLEAN NOT NULL,
  analytics_denominator_empty BOOLEAN NOT NULL,
  control_total_mismatch BOOLEAN NOT NULL,
  missing_count BIGINT CHECK (missing_count IS NULL OR missing_count >= 0),
  phantom_count BIGINT CHECK (phantom_count IS NULL OR phantom_count >= 0),
  state_mismatch_count BIGINT CHECK (state_mismatch_count IS NULL OR state_mismatch_count >= 0),
  amount_mismatch_count BIGINT CHECK (amount_mismatch_count IS NULL OR amount_mismatch_count >= 0),
  missing_rate DOUBLE PRECISION CHECK (missing_rate IS NULL OR (missing_rate >= 0 AND missing_rate <= 1)),
  phantom_rate DOUBLE PRECISION CHECK (phantom_rate IS NULL OR (phantom_rate >= 0 AND phantom_rate <= 1)),
  state_mismatch_rate DOUBLE PRECISION
    CHECK (state_mismatch_rate IS NULL OR (state_mismatch_rate >= 0 AND state_mismatch_rate <= 1)),
  amount_mismatch_rate DOUBLE PRECISION
    CHECK (amount_mismatch_rate IS NULL OR (amount_mismatch_rate >= 0 AND amount_mismatch_rate <= 1)),
  revenue_deviation JSONB NOT NULL CHECK (jsonb_typeof(revenue_deviation) = 'array'),
  evidence_hash CHAR(64) NOT NULL CHECK (evidence_hash ~ '^[a-f0-9]{64}$'),
  comparison_document JSONB NOT NULL CHECK (jsonb_typeof(comparison_document) = 'object'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (source_id, snapshot_id, comparison_revision),
  FOREIGN KEY (source_id, snapshot_id)
    REFERENCES reconciliation_snapshots(source_id, snapshot_id),
  CHECK (source_denominator_empty = (source_count = 0)),
  CHECK (analytics_denominator_empty = (analytics_count = 0)),
  CHECK (
    (record_level_metrics_available
      AND missing_count IS NOT NULL
      AND phantom_count IS NOT NULL
      AND state_mismatch_count IS NOT NULL
      AND amount_mismatch_count IS NOT NULL)
    OR
    (NOT record_level_metrics_available
      AND missing_count IS NULL
      AND phantom_count IS NULL
      AND state_mismatch_count IS NULL
      AND amount_mismatch_count IS NULL
      AND missing_rate IS NULL
      AND phantom_rate IS NULL
      AND state_mismatch_rate IS NULL
      AND amount_mismatch_rate IS NULL)
  ),
  CHECK (
    (window_state IN ('RECONCILING', 'RECONCILED') AND limitation_reason IS NULL)
    OR (window_state = 'DEGRADED' AND limitation_reason IS NOT NULL)
  ),
  CHECK (
    (window_state = 'RECONCILED'
      AND record_level_metrics_available
      AND NOT control_total_mismatch
      AND missing_count = 0
      AND phantom_count = 0
      AND state_mismatch_count = 0
      AND amount_mismatch_count = 0)
    OR
    (window_state = 'RECONCILING'
      AND record_level_metrics_available
      AND (control_total_mismatch
        OR missing_count > 0
        OR phantom_count > 0
        OR state_mismatch_count > 0
        OR amount_mismatch_count > 0))
    OR
    (window_state = 'DEGRADED' AND NOT record_level_metrics_available)
  )
);

CREATE TABLE IF NOT EXISTS reconciliation_analytics_observations (
  comparison_id TEXT NOT NULL REFERENCES reconciliation_comparisons(comparison_id),
  entity_id TEXT NOT NULL,
  current_status TEXT NOT NULL,
  entity_version TEXT,
  analytics_updated_at TIMESTAMPTZ,
  analytics_occurred_at TIMESTAMPTZ,
  analytics_committed_at TIMESTAMPTZ,
  tombstone BOOLEAN NOT NULL,
  amount NUMERIC,
  currency CHAR(3),
  observation_document JSONB NOT NULL CHECK (jsonb_typeof(observation_document) = 'object'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comparison_id, entity_id),
  CHECK (entity_version IS NOT NULL OR analytics_updated_at IS NOT NULL),
  CHECK ((amount IS NULL) = (currency IS NULL))
);

CREATE TABLE IF NOT EXISTS reconciliation_discrepancies (
  comparison_id TEXT NOT NULL REFERENCES reconciliation_comparisons(comparison_id),
  discrepancy_kind TEXT NOT NULL
    CHECK (discrepancy_kind IN ('MISSING', 'PHANTOM', 'STATE_MISMATCH', 'AMOUNT_MISMATCH')),
  entity_id TEXT NOT NULL,
  source_record JSONB CHECK (source_record IS NULL OR jsonb_typeof(source_record) = 'object'),
  analytics_record JSONB CHECK (analytics_record IS NULL OR jsonb_typeof(analytics_record) = 'object'),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (comparison_id, discrepancy_kind, entity_id),
  CHECK (
    (discrepancy_kind = 'MISSING' AND source_record IS NOT NULL AND analytics_record IS NULL)
    OR (discrepancy_kind = 'PHANTOM' AND source_record IS NULL AND analytics_record IS NOT NULL)
    OR (discrepancy_kind IN ('STATE_MISMATCH', 'AMOUNT_MISMATCH')
      AND source_record IS NOT NULL AND analytics_record IS NOT NULL)
  )
);

DROP TRIGGER IF EXISTS reconciliation_comparisons_immutable ON reconciliation_comparisons;
CREATE TRIGGER reconciliation_comparisons_immutable
BEFORE UPDATE OR DELETE ON reconciliation_comparisons
FOR EACH ROW EXECUTE FUNCTION reject_reconciliation_evidence_mutation();

DROP TRIGGER IF EXISTS reconciliation_analytics_observations_immutable
  ON reconciliation_analytics_observations;
CREATE TRIGGER reconciliation_analytics_observations_immutable
BEFORE UPDATE OR DELETE ON reconciliation_analytics_observations
FOR EACH ROW EXECUTE FUNCTION reject_reconciliation_evidence_mutation();

DROP TRIGGER IF EXISTS reconciliation_discrepancies_immutable ON reconciliation_discrepancies;
CREATE TRIGGER reconciliation_discrepancies_immutable
BEFORE UPDATE OR DELETE ON reconciliation_discrepancies
FOR EACH ROW EXECUTE FUNCTION reject_reconciliation_evidence_mutation();

CREATE INDEX IF NOT EXISTS reconciliation_comparisons_scope_idx
  ON reconciliation_comparisons (source_id, snapshot_id, comparison_revision DESC);

CREATE INDEX IF NOT EXISTS reconciliation_comparisons_state_idx
  ON reconciliation_comparisons (source_id, window_state, recorded_at DESC);

CREATE INDEX IF NOT EXISTS reconciliation_discrepancies_kind_idx
  ON reconciliation_discrepancies (comparison_id, discrepancy_kind);

COMMIT;
