BEGIN;

CREATE TABLE IF NOT EXISTS ingress_accepted_receipts (
  source_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  ingestion_id TEXT NOT NULL UNIQUE,
  ingestion_attempt_id TEXT,
  received_at TIMESTAMPTZ NOT NULL,
  receipt_document JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, event_id),
  CONSTRAINT ingress_accepted_receipts_status_check
    CHECK (receipt_document->>'status' = 'accepted')
);

CREATE INDEX IF NOT EXISTS ingress_accepted_receipts_received_idx
  ON ingress_accepted_receipts (source_id, received_at DESC);

CREATE TABLE IF NOT EXISTS canonicalization_outcomes (
  source_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  mapping_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('normalized', 'unsupported', 'quarantined')),
  canonical_event_id TEXT,
  reason_code TEXT,
  processed_at TIMESTAMPTZ NOT NULL,
  raw_record_id TEXT NOT NULL,
  outcome_document JSONB NOT NULL,
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, source_event_id, mapping_version),
  CONSTRAINT canonicalization_outcomes_shape_check CHECK (
    (status = 'normalized' AND canonical_event_id IS NOT NULL AND reason_code IS NULL)
    OR (status IN ('unsupported', 'quarantined') AND canonical_event_id IS NULL AND reason_code IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS canonicalization_outcomes_processed_idx
  ON canonicalization_outcomes (source_id, processed_at DESC);

CREATE INDEX IF NOT EXISTS canonicalization_outcomes_status_idx
  ON canonicalization_outcomes (source_id, status, processed_at DESC);

CREATE OR REPLACE VIEW canonicalization_latest_outcomes AS
SELECT DISTINCT ON (source_id, source_event_id)
       source_id, source_event_id, mapping_version, status, canonical_event_id,
       reason_code, processed_at, raw_record_id, recorded_at
  FROM canonicalization_outcomes
 ORDER BY source_id, source_event_id, processed_at DESC, mapping_version DESC;

COMMIT;
