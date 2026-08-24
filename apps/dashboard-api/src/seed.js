import { randomUUID } from "node:crypto";
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

/** Demo: keep DASHBOARD_ADMIN_* in k8s secret in sync with the login user. */
export async function seedAdminUser() {
  await ensureDashboardSchema();

  const email = config.adminEmail.trim().toLowerCase();
  const hash = await hashPassword(config.adminPassword);

  const [existing] = await query(
    `SELECT id, email FROM dashboard_users WHERE LOWER(email) = LOWER($1)`,
    [email]
  );
  if (existing) {
    await query(
      `UPDATE dashboard_users
       SET password_hash = $1, is_active = true, updated_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [hash, existing.id]
    );
    console.log("synced admin credentials for:", email);
    return;
  }

  const supers = await query(
    `SELECT id, email FROM dashboard_users WHERE role = 'super_admin' ORDER BY created_at`
  );
  if (supers.length === 1) {
    const prev = supers[0].email;
    await query(
      `UPDATE dashboard_users
       SET email = $1, password_hash = $2, is_active = true, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [email, hash, supers[0].id]
    );
    console.log(`migrated super_admin ${prev} → ${email}`);
    return;
  }

  const rows = await query("SELECT COUNT(*)::int AS n FROM dashboard_users");
  if (rows[0]?.n > 0) {
    console.warn(
      `seed: no user ${email}; ${rows[0].n} account(s) already exist — use Admin → Tài khoản or reset Postgres PVC`
    );
    return;
  }

  await query(
    `INSERT INTO dashboard_users (id, email, password_hash, display_name, role)
     VALUES ($1, $2, $3, $4, 'super_admin')`,
    [randomUUID(), email, hash, "Super Admin"]
  );
  console.log("seeded default super_admin:", email);
}
