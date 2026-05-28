import { query } from "./db.js";
import { config } from "./config.js";
import { hashPassword } from "./lib/password.js";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS dashboard_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  display_name  VARCHAR(100),
  role          VARCHAR(20) NOT NULL DEFAULT 'analyst'
                CHECK (role IN ('super_admin', 'analyst')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  last_login_at TIMESTAMP,
  created_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_dashboard_users_email ON dashboard_users (email);
`;

export async function ensureDashboardSchema() {
  await query(SCHEMA_SQL);
}

export async function seedAdminUser() {
  await ensureDashboardSchema();

  const rows = await query("SELECT COUNT(*)::int AS n FROM dashboard_users");
  if (rows[0]?.n > 0) return;

  const hash = await hashPassword(config.adminPassword);
  await query(
    `INSERT INTO dashboard_users (email, password_hash, display_name, role)
     VALUES ($1, $2, $3, 'super_admin')`,
    [config.adminEmail.trim().toLowerCase(), hash, "Super Admin"]
  );
  console.log("seeded default super_admin:", config.adminEmail);
}
