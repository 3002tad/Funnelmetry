CREATE TABLE IF NOT EXISTS cart_cdc_input_offsets (
  source_id text NOT NULL,
  coverage_epoch_id text NOT NULL,
  topic text NOT NULL,
  partition integer NOT NULL,
  next_offset bigint NOT NULL CHECK (next_offset >= 0),
  PRIMARY KEY (source_id, coverage_epoch_id, topic, partition)
);

CREATE TABLE IF NOT EXISTS cart_cdc_line_state (
  source_id text NOT NULL,
  coverage_epoch_id text NOT NULL,
  line_item_id text NOT NULL,
  cart_id text NOT NULL,
  product_id text,
  variant_id text,
  quantity integer NOT NULL CHECK (quantity >= 0),
  deleted boolean NOT NULL,
  source_updated_raw text,
  PRIMARY KEY (source_id, coverage_epoch_id, line_item_id)
);

CREATE TABLE IF NOT EXISTS cart_cdc_canonical_outbox (
  canonical_event_id text PRIMARY KEY,
  source_id text NOT NULL,
  coverage_epoch_id text NOT NULL,
  source_topic text NOT NULL,
  source_partition integer NOT NULL,
  source_offset bigint NOT NULL,
  canonical_event jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  delivered_at timestamptz,
  UNIQUE (source_id, coverage_epoch_id, source_topic, source_partition, source_offset)
);
CREATE INDEX IF NOT EXISTS cart_cdc_outbox_pending_idx
  ON cart_cdc_canonical_outbox (created_at, canonical_event_id)
  WHERE delivered_at IS NULL;
