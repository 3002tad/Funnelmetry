-- CDC-11 candidate only. Persist first observation of source orders that have
-- not reached the order-v2 sink yet, so a monitor restart cannot reset their
-- bounded-lag age. No live analytical binding is changed by this table.
CREATE TABLE reference_cdc_v2_pending_quality_candidate (
  source_instance_id text NOT NULL,
  coverage_epoch_id text NOT NULL,
  order_id text NOT NULL,
  first_observed_at timestamptz NOT NULL,
  last_observed_at timestamptz NOT NULL,
  PRIMARY KEY (source_instance_id, coverage_epoch_id, order_id),
  CHECK (last_observed_at >= first_observed_at)
);
