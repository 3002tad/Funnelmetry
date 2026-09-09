BEGIN;
CREATE TABLE IF NOT EXISTS dashboard_account_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID NOT NULL,
  target_id UUID NOT NULL,
  action TEXT NOT NULL,
  changes JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS dashboard_account_audit_target_time
  ON dashboard_account_audit(target_id, created_at);
COMMIT;
