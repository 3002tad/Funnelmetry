-- Dashboard account migration; not a canonical ledger migration.
-- Retain viewer only for existing accounts; new assignments use three roles.
BEGIN;
ALTER TABLE dashboard_users DROP CONSTRAINT IF EXISTS dashboard_users_role_check;
ALTER TABLE dashboard_users ADD CONSTRAINT dashboard_users_role_check
  CHECK (role IN ('super_admin', 'analyst', 'staff', 'viewer'));
ALTER TABLE dashboard_users ALTER COLUMN role SET DEFAULT 'analyst';
COMMIT;
