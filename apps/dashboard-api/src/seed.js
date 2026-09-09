import { randomUUID } from "node:crypto";
import { transaction } from "./db.js";
import { config } from "./config.js";
import { hashPassword } from "./lib/password.js";

/** Bootstrap only an empty account store; never reset existing access on restart. */
export async function seedAdminUser() {
  const email = config.adminEmail.trim().toLowerCase();
  const hash = await hashPassword(config.adminPassword);
  const created = await transaction(async execute => {
    // Match account-management locking; check emptiness only after acquiring it.
    await execute('LOCK TABLE dashboard_users IN SHARE ROW EXCLUSIVE MODE');
    const [existing] = await execute('SELECT id FROM dashboard_users LIMIT 1');
    if (existing) return false;
    const id = randomUUID();
    await execute(`INSERT INTO dashboard_users (id,email,password_hash,display_name,role)
      VALUES ($1,$2,$3,$4,'super_admin')`, [id, email, hash, 'Super Admin']);
    // Self-reference identifies the bootstrapped account, not an authenticated operator.
    await execute(`INSERT INTO dashboard_account_audit(actor_id,target_id,action,changes)
      VALUES ($1,$1,'account.bootstrapped','{"role":"super_admin","is_active":true}'::jsonb)`, [id]);
    return true;
  });
  if (created) console.log('seed: initial admin created with bootstrap audit');
}
