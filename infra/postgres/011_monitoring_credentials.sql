-- Additive operator-applied migration. Does not change event/cursor tables.
BEGIN;
CREATE TABLE IF NOT EXISTS monitoring_credentials (
  id uuid PRIMARY KEY,
  label varchar(80) NOT NULL,
  secret_hash char(64) NOT NULL,
  created_by uuid NOT NULL REFERENCES dashboard_users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE TABLE IF NOT EXISTS monitoring_credential_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  credential_id uuid NOT NULL REFERENCES monitoring_credentials(id),
  actor_id uuid NOT NULL REFERENCES dashboard_users(id),
  action text NOT NULL CHECK (action IN ('issued', 'revoked')),
  occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
COMMIT;
