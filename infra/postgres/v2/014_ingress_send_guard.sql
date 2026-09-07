BEGIN;

-- Legacy claims have no evidence that sending has not started. Never infer it.
ALTER TABLE ingress_receipt_claims
  ADD COLUMN IF NOT EXISTS send_authorized BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS send_guard_owner_token TEXT;

COMMIT;
