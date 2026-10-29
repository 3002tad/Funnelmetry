-- Stage 2 CDC context candidate. No analytical availability/price binding is active.
-- The source row payload is constrained by the writer's versioned column allowlist.
CREATE TABLE IF NOT EXISTS inventory_price_cdc_context_current (
  source_id text NOT NULL,
  coverage_epoch_id text NOT NULL,
  table_name text NOT NULL,
  row_key jsonb NOT NULL CHECK (jsonb_typeof(row_key) = 'array'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  soft_deleted boolean NOT NULL,
  source_lsn bigint,
  topic text NOT NULL,
  last_topic_offset bigint NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, coverage_epoch_id, table_name, row_key)
);
CREATE INDEX IF NOT EXISTS inventory_price_cdc_context_by_table
  ON inventory_price_cdc_context_current
  (source_id, coverage_epoch_id, table_name, soft_deleted);
CREATE TABLE IF NOT EXISTS inventory_price_cdc_input_offsets (
  source_id text NOT NULL,
  coverage_epoch_id text NOT NULL,
  topic text NOT NULL,
  partition integer NOT NULL,
  next_offset bigint NOT NULL CHECK (next_offset >= 0),
  PRIMARY KEY (source_id, coverage_epoch_id, topic, partition)
);
CREATE TABLE IF NOT EXISTS inventory_price_cdc_ingest_audit (
  source_id text NOT NULL,
  coverage_epoch_id text NOT NULL,
  topic text NOT NULL,
  partition integer NOT NULL,
  kafka_offset bigint NOT NULL,
  table_name text NOT NULL,
  row_key jsonb NOT NULL,
  op text NOT NULL CHECK (op IN ('r','c','u','d')),
  source_lsn bigint,
  snapshot_marker text,
  projected_payload jsonb,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, coverage_epoch_id, topic, partition, kafka_offset)
);
CREATE TABLE IF NOT EXISTS inventory_price_cdc_capture_status (
  source_id text NOT NULL,
  coverage_epoch_id text NOT NULL,
  snapshot_last_seen boolean NOT NULL DEFAULT false,
  last_input_at timestamptz,
  PRIMARY KEY (source_id, coverage_epoch_id)
);
CREATE TABLE IF NOT EXISTS inventory_price_cdc_quality_lease (
  source_id text PRIMARY KEY,
  coverage_epoch_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('SHADOW','PASS','BLOCKED_BY_QUALITY')),
  snapshot_complete boolean NOT NULL,
  source_row_counts jsonb NOT NULL CHECK (jsonb_typeof(source_row_counts) = 'object'),
  projection_row_counts jsonb NOT NULL CHECK (jsonb_typeof(projection_row_counts) = 'object'),
  source_digest text,
  projection_digest text,
  topic_end_offsets jsonb NOT NULL CHECK (jsonb_typeof(topic_end_offsets) = 'object'),
  applied_offsets jsonb NOT NULL CHECK (jsonb_typeof(applied_offsets) = 'object'),
  slot_status text NOT NULL,
  connector_running boolean NOT NULL,
  verified_at timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  evidence_ref text NOT NULL,
  CHECK (status <> 'PASS' OR
    (snapshot_complete AND source_row_counts = projection_row_counts
     AND source_digest IS NOT NULL AND source_digest = projection_digest
     AND topic_end_offsets = applied_offsets AND connector_running
     AND slot_status IN ('reserved','extended') AND valid_until > verified_at))
);
-- Explicitly omit an ACTIVE binding/view: context equality is not a business
-- resolution of sellable inventory or customer-visible price.
