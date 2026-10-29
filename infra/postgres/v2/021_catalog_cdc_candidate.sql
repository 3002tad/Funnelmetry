-- Medusa catalog CDC candidate. No binding is active by default.
-- The API-created reference tables remain untouched for rollback.
CREATE TABLE IF NOT EXISTS catalog_cdc_products_current (
  source_id text NOT NULL,
  coverage_epoch_id text NOT NULL,
  product_id text NOT NULL,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 500),
  handle text,
  status text,
  collection_id text,
  source_updated_raw text,
  soft_deleted boolean NOT NULL,
  source_lsn bigint,
  last_topic_offset bigint NOT NULL,
  PRIMARY KEY (source_id, coverage_epoch_id, product_id)
);
CREATE TABLE IF NOT EXISTS catalog_cdc_variants_current (
  source_id text NOT NULL,
  coverage_epoch_id text NOT NULL,
  variant_id text NOT NULL,
  product_id text NOT NULL,
  title text,
  sku text,
  manage_inventory boolean,
  allow_backorder boolean,
  source_updated_raw text,
  soft_deleted boolean NOT NULL,
  source_lsn bigint,
  last_topic_offset bigint NOT NULL,
  PRIMARY KEY (source_id, coverage_epoch_id, variant_id)
);
CREATE INDEX IF NOT EXISTS catalog_cdc_variants_by_product
  ON catalog_cdc_variants_current (source_id, coverage_epoch_id, product_id);
CREATE TABLE IF NOT EXISTS catalog_cdc_categories_current (
  source_id text NOT NULL,
  coverage_epoch_id text NOT NULL,
  category_id text NOT NULL,
  name text,
  parent_category_id text,
  is_active boolean,
  is_internal boolean,
  source_updated_raw text,
  soft_deleted boolean NOT NULL,
  source_lsn bigint,
  last_topic_offset bigint NOT NULL,
  PRIMARY KEY (source_id, coverage_epoch_id, category_id)
);
CREATE TABLE IF NOT EXISTS catalog_cdc_product_categories_current (
  source_id text NOT NULL,
  coverage_epoch_id text NOT NULL,
  product_id text NOT NULL,
  category_id text NOT NULL,
  source_lsn bigint,
  last_topic_offset bigint NOT NULL,
  PRIMARY KEY (source_id, coverage_epoch_id, product_id, category_id)
);
CREATE TABLE IF NOT EXISTS catalog_cdc_input_offsets (
  source_id text NOT NULL,
  coverage_epoch_id text NOT NULL,
  topic text NOT NULL,
  partition integer NOT NULL,
  next_offset bigint NOT NULL CHECK (next_offset >= 0),
  PRIMARY KEY (source_id, coverage_epoch_id, topic, partition)
);
CREATE TABLE IF NOT EXISTS catalog_cdc_ingest_audit (
  source_id text NOT NULL,
  coverage_epoch_id text NOT NULL,
  topic text NOT NULL,
  partition integer NOT NULL,
  kafka_offset bigint NOT NULL,
  table_name text NOT NULL,
  row_key text NOT NULL,
  op text NOT NULL CHECK (op IN ('r','c','u','d')),
  source_lsn bigint,
  snapshot_marker text,
  projected_payload jsonb,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, coverage_epoch_id, topic, partition, kafka_offset)
);
CREATE TABLE IF NOT EXISTS catalog_cdc_capture_status (
  source_id text NOT NULL,
  coverage_epoch_id text NOT NULL,
  snapshot_last_seen boolean NOT NULL DEFAULT false,
  last_input_at timestamptz,
  PRIMARY KEY (source_id, coverage_epoch_id)
);
CREATE TABLE IF NOT EXISTS catalog_cdc_quality_lease (
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
     AND slot_status IN ('reserved','extended')
     AND valid_until > verified_at))
);
CREATE TABLE IF NOT EXISTS catalog_cdc_binding (
  source_id text PRIMARY KEY,
  coverage_epoch_id text NOT NULL,
  state text NOT NULL CHECK (state IN ('SHADOW','ACTIVE','ROLLED_BACK')),
  activated_at timestamptz,
  decision_ref text NOT NULL,
  CHECK (state <> 'ACTIVE' OR activated_at IS NOT NULL)
);
-- This view is empty until an explicit binding and fresh, reconciled quality
-- lease exist. It only supplies current descriptive names, never order money.
CREATE OR REPLACE VIEW current_product_reference_names_cdc AS
SELECT p.source_id, p.product_id, p.title,
       p.source_updated_raw AS source_updated_at,
       NULL::uuid AS snapshot_id,
       q.verified_at AS observed_at,
       'medusa-postgres-cdc-v1'::text AS provider,
       p.coverage_epoch_id
FROM catalog_cdc_products_current AS p
JOIN catalog_cdc_binding AS b
  ON b.source_id = p.source_id AND b.coverage_epoch_id = p.coverage_epoch_id
JOIN catalog_cdc_quality_lease AS q
  ON q.source_id = p.source_id AND q.coverage_epoch_id = p.coverage_epoch_id
WHERE b.state = 'ACTIVE' AND q.status = 'PASS'
  AND q.snapshot_complete AND q.valid_until > clock_timestamp()
  AND q.source_row_counts = q.projection_row_counts
  AND q.source_digest = q.projection_digest
  AND q.topic_end_offsets = q.applied_offsets
  AND q.slot_status IN ('reserved','extended') AND q.connector_running
  AND NOT p.soft_deleted;
