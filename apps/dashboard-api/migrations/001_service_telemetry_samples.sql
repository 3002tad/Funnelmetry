-- Optional operational telemetry; no business facts or controller audit changes.
CREATE TABLE IF NOT EXISTS service_telemetry_samples (
  stack_name text NOT NULL,
  service_name text NOT NULL CHECK (service_name = 'canonical-normalizer'),
  consumer_group_id text NOT NULL,
  topic text NOT NULL,
  observed_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  desired_replicas integer CHECK (desired_replicas BETWEEN 0 AND 10000),
  running_replicas integer CHECK (running_replicas BETWEEN 0 AND 10000),
  memory_percent_max double precision CHECK (memory_percent_max BETWEEN 0 AND 100),
  raw_offset_lag numeric(40,0) CHECK (raw_offset_lag >= 0),
  consumable_lag numeric(40,0) CHECK (consumable_lag >= 0),
  partition_count integer CHECK (partition_count BETWEEN 1 AND 128),
  control_only_partitions integer CHECK (control_only_partitions BETWEEN 0 AND 128),
  lag_status text NOT NULL CHECK (lag_status IN ('OBSERVED','UNVERIFIED')),
  lag_reason text NOT NULL,
  readiness_status text NOT NULL CHECK (readiness_status IN ('READY','DEGRADED','STARTING','STOPPING','UNVERIFIED')),
  measurement_version text NOT NULL CHECK (measurement_version = 'read_committed_tail_v1'),
  PRIMARY KEY (stack_name, service_name, consumer_group_id, topic, observed_at),
  CHECK (consumable_lag IS NULL OR raw_offset_lag IS NOT NULL AND consumable_lag <= raw_offset_lag),
  CHECK ((lag_status = 'OBSERVED') = (consumable_lag IS NOT NULL))
);
COMMENT ON TABLE service_telemetry_samples IS 'Operational collector samples; unavailable measurements are NULL. Not business events or executed scaling actions.';
