-- Dashboard accounts for analytics users (not shop customers).

CREATE TABLE IF NOT EXISTS dashboard_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name  VARCHAR(100),
  role          VARCHAR(20) NOT NULL DEFAULT 'viewer'
                CHECK (role IN ('super_admin', 'analyst', 'viewer')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_dashboard_users_email ON dashboard_users (email);
CREATE INDEX IF NOT EXISTS idx_dashboard_users_role ON dashboard_users (role);
