BEGIN;

-- A boot generation identifies a Gateway runtime, not Kafka's numeric epoch.
-- No backfill: historical claims cannot establish this evidence retrospectively.
CREATE TABLE IF NOT EXISTS ingress_send_attempts (
  source_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  owner_token TEXT NOT NULL,
  ingestion_id TEXT NOT NULL,
  transactional_id TEXT NOT NULL CHECK (length(transactional_id) > 0),
  producer_generation_id TEXT NOT NULL CHECK (length(producer_generation_id) > 0),
  authorized_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, event_id, owner_token),
  FOREIGN KEY (source_id, event_id) REFERENCES ingress_receipt_claims (source_id, event_id)
);

CREATE INDEX IF NOT EXISTS ingress_send_attempts_producer_idx
  ON ingress_send_attempts (transactional_id, producer_generation_id);

COMMIT;
