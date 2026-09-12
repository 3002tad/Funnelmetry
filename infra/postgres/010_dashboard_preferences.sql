BEGIN;
CREATE TABLE IF NOT EXISTS dashboard_account_preferences (
  user_id UUID PRIMARY KEY REFERENCES dashboard_users(id) ON DELETE CASCADE,
  preferences JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(preferences) = 'object'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
COMMIT;
