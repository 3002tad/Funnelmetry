BEGIN;

CREATE TABLE IF NOT EXISTS ingress_producer_generations (
  transactional_id TEXT PRIMARY KEY CHECK (length(transactional_id) > 0),
  generation_id TEXT NOT NULL CHECK (length(generation_id) > 0),
  phase TEXT NOT NULL CHECK (phase IN ('INITIALIZING', 'READY')),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Do not infer an active generation from historical attempts or owner tokens.
COMMIT;
