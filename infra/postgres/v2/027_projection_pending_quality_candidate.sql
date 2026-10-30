-- CDC-11 candidate only. Persists the first observation of a catalog or
-- inventory/price row that has not yet reconciled with the source. This table
-- does not grant a quality lease or activate an analytical binding.
CREATE TABLE cdc_projection_pending_quality_candidate (
  source_id text NOT NULL,
  coverage_epoch_id text NOT NULL,
  stream_name text NOT NULL CHECK (stream_name IN ('catalog', 'inventory_price')),
  row_key text NOT NULL,
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  PRIMARY KEY (source_id, coverage_epoch_id, stream_name, row_key),
  CHECK (last_observed_at >= first_observed_at)
);
