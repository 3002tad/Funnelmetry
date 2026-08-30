BEGIN;

CREATE TABLE IF NOT EXISTS canonical_events (
  canonical_event_id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_class TEXT NOT NULL CHECK (event_class IN ('BEHAVIOR_INTENT', 'CLIENT_OBSERVATION', 'BUSINESS_FACT')),
  canonical_schema_version TEXT NOT NULL,
  mapping_version TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL,
  produced_at TIMESTAMPTZ,
  ingested_at TIMESTAMPTZ NOT NULL,
  normalized_at TIMESTAMPTZ NOT NULL,
  aggregate_type TEXT,
  aggregate_id TEXT,
  aggregate_version TEXT,
  relations JSONB,
  identity JSONB,
  data JSONB NOT NULL,
  quality JSONB NOT NULL,
  raw_record_id TEXT NOT NULL,
  raw_content_hash CHAR(64) NOT NULL CHECK (raw_content_hash ~ '^[a-f0-9]{64}$'),
  raw_byte_size BIGINT NOT NULL CHECK (raw_byte_size >= 0),
  canonical_document JSONB NOT NULL,
  persisted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT canonical_events_source_mapping_key UNIQUE (source_id, source_event_id, mapping_version),
  CONSTRAINT canonical_events_aggregate_shape CHECK (
    (aggregate_type IS NULL AND aggregate_id IS NULL AND aggregate_version IS NULL)
    OR (aggregate_type IS NOT NULL AND aggregate_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS canonical_events_occurred_at_idx
  ON canonical_events (occurred_at DESC);

CREATE INDEX IF NOT EXISTS canonical_events_type_occurred_idx
  ON canonical_events (event_type, occurred_at DESC);

CREATE INDEX IF NOT EXISTS canonical_events_source_event_idx
  ON canonical_events (source_id, source_event_id);

CREATE INDEX IF NOT EXISTS canonical_events_aggregate_idx
  ON canonical_events (source_id, aggregate_type, aggregate_id)
  WHERE aggregate_id IS NOT NULL;

COMMIT;
