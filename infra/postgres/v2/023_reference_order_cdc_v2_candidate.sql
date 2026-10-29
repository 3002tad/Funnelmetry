-- Reference Medusa order recorded current-state v2 candidate.
-- No canonical order.placed or live funnel binding is changed by this migration.
CREATE TABLE IF NOT EXISTS reference_cdc_v2_record_inbox (
  record_id text PRIMARY KEY,
  source_instance_id text NOT NULL,
  coverage_epoch_id text NOT NULL,
  fact_topic text NOT NULL,
  order_id text NOT NULL,
  record_type text NOT NULL CHECK
    (record_type IN ('BASELINE','BASELINE_COMPLETE','STATE','TRANSITION','CORRECTION')),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  kafka_partition integer NOT NULL,
  kafka_offset bigint NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (fact_topic, kafka_partition, kafka_offset)
);
CREATE TABLE IF NOT EXISTS reference_cdc_v2_order_current_state (
  source_instance_id text NOT NULL,
  coverage_epoch_id text NOT NULL,
  order_id text NOT NULL,
  cart_id text,
  active boolean NOT NULL,
  last_record_id text NOT NULL REFERENCES reference_cdc_v2_record_inbox(record_id),
  last_topic_offset bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_instance_id, coverage_epoch_id, order_id)
);
CREATE TABLE IF NOT EXISTS reference_cdc_v2_sink_offsets (
  fact_topic text NOT NULL,
  partition integer NOT NULL,
  next_offset bigint NOT NULL CHECK (next_offset >= 0),
  PRIMARY KEY (fact_topic, partition)
);
CREATE TABLE IF NOT EXISTS reference_cdc_v2_quality_state (
  source_instance_id text NOT NULL,
  coverage_epoch_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('BLOCKED_BY_QUALITY','CURRENT_STATE_READY')),
  historical_gap_status text NOT NULL CHECK (historical_gap_status = 'INCOMPLETE'),
  baseline_complete boolean NOT NULL DEFAULT false,
  baseline_orders integer,
  baseline_active_orders integer,
  baseline_digest text,
  reason text NOT NULL,
  verified_at timestamptz,
  valid_until timestamptz,
  PRIMARY KEY (source_instance_id, coverage_epoch_id),
  CHECK (status <> 'CURRENT_STATE_READY' OR
    (baseline_complete AND verified_at IS NOT NULL AND
     valid_until IS NOT NULL AND valid_until > verified_at))
);
CREATE OR REPLACE VIEW reference_cdc_v2_order_current_state_readable AS
SELECT s.source_instance_id, s.coverage_epoch_id, s.order_id, s.cart_id,
       s.active, s.last_record_id, s.last_topic_offset, s.updated_at
FROM reference_cdc_v2_order_current_state AS s
JOIN reference_cdc_v2_quality_state AS q
  ON q.source_instance_id = s.source_instance_id
 AND q.coverage_epoch_id = s.coverage_epoch_id
WHERE q.status = 'CURRENT_STATE_READY'
  AND q.baseline_complete
  AND q.historical_gap_status = 'INCOMPLETE'
  AND q.valid_until > clock_timestamp();
