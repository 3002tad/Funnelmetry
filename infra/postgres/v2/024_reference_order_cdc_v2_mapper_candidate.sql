-- Reference Medusa order-state v2 mapper candidate. One DB per source/epoch.

CREATE TABLE IF NOT EXISTS reference_cdc_v2_epochs (
  coverage_epoch_id text PRIMARY KEY, previous_epoch_id text NOT NULL,
  previous_epoch_gap text NOT NULL, source_prefix text NOT NULL,
  fact_topic text NOT NULL, status text NOT NULL,
  snapshot_last_seen boolean NOT NULL DEFAULT false,
  baseline_digest text, baseline_active_count integer,
  baseline_verified_at timestamptz, last_processed_end_id text,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK(status IN ('BASELINING','BASELINE_VERIFIED','BLOCKED_BY_QUALITY')),
  CHECK(previous_epoch_gap = 'INCOMPLETE')
);
CREATE TABLE IF NOT EXISTS reference_cdc_v2_input_offsets (
  topic text NOT NULL, partition integer NOT NULL, next_offset bigint NOT NULL,
  PRIMARY KEY(topic,partition)
);
CREATE TABLE IF NOT EXISTS reference_cdc_v2_snapshot_rows (
  topic text NOT NULL, partition integer NOT NULL, kafka_offset bigint NOT NULL,
  table_name text NOT NULL, row_id text NOT NULL, payload jsonb NOT NULL,
  PRIMARY KEY(topic,partition,kafka_offset), UNIQUE(table_name,row_id)
);
CREATE TABLE IF NOT EXISTS reference_cdc_v2_stream_rows (
  event_key text PRIMARY KEY, txid bigint NOT NULL, table_name text NOT NULL,
  total_order bigint NOT NULL, lsn bigint NOT NULL, payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS reference_cdc_v2_stream_rows_txid ON reference_cdc_v2_stream_rows(txid);
CREATE TABLE IF NOT EXISTS reference_cdc_v2_ends (
  txid bigint PRIMARY KEY, topic_offset bigint NOT NULL UNIQUE,
  end_id text NOT NULL, expected jsonb NOT NULL, source_ts_ms bigint,
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS reference_cdc_v2_ends_pending ON reference_cdc_v2_ends(topic_offset) WHERE processed_at IS NULL;
CREATE TABLE IF NOT EXISTS reference_cdc_v2_source_orders (id text PRIMARY KEY, present boolean NOT NULL);
CREATE TABLE IF NOT EXISTS reference_cdc_v2_source_carts (id text PRIMARY KEY, completed boolean NOT NULL);
CREATE TABLE IF NOT EXISTS reference_cdc_v2_source_links (
  id text PRIMARY KEY, order_id text NOT NULL, cart_id text NOT NULL
);
CREATE INDEX IF NOT EXISTS reference_cdc_v2_source_links_order ON reference_cdc_v2_source_links(order_id);
CREATE TABLE IF NOT EXISTS reference_cdc_v2_state (
  order_id text PRIMARY KEY, active boolean NOT NULL, cart_id text,
  last_revision text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS reference_cdc_v2_outbox (
  seq bigserial PRIMARY KEY, record_id text NOT NULL UNIQUE,
  order_id text NOT NULL, record_type text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE INDEX IF NOT EXISTS reference_cdc_v2_outbox_unpublished ON reference_cdc_v2_outbox(seq) WHERE published_at IS NULL;
