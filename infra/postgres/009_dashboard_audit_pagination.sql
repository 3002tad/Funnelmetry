BEGIN;
CREATE INDEX IF NOT EXISTS dashboard_account_audit_time_id
  ON dashboard_account_audit(created_at DESC, id DESC);
COMMIT;
