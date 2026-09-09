BEGIN;
ALTER TABLE dashboard_users ADD COLUMN IF NOT EXISTS session_version INTEGER NOT NULL DEFAULT 0;
CREATE OR REPLACE FUNCTION dashboard_revoke_sessions() RETURNS trigger AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash
     OR NEW.role IS DISTINCT FROM OLD.role
     OR NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    NEW.session_version := OLD.session_version + 1;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS dashboard_revoke_sessions ON dashboard_users;
CREATE TRIGGER dashboard_revoke_sessions BEFORE UPDATE ON dashboard_users
FOR EACH ROW EXECUTE FUNCTION dashboard_revoke_sessions();
COMMIT;
