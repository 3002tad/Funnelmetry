BEGIN;

ALTER TABLE ingress_send_attempts ADD COLUMN IF NOT EXISTS kafka_scope JSONB;

CREATE TABLE IF NOT EXISTS ingress_claim_recoveries (
  source_id TEXT NOT NULL,
  event_id TEXT NOT NULL,
  owner_token TEXT NOT NULL,
  ingestion_id TEXT NOT NULL,
  transactional_id TEXT NOT NULL,
  previous_generation_id TEXT NOT NULL,
  recovery_generation_id TEXT NOT NULL,
  kafka_scope JSONB NOT NULL,
  replay_offsets JSONB NOT NULL,
  recovered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (source_id, event_id, owner_token),
  FOREIGN KEY (source_id, event_id, owner_token)
    REFERENCES ingress_send_attempts (source_id, event_id, owner_token)
);

-- No historical scope backfill. Missing evidence must remain pending.
COMMIT;
