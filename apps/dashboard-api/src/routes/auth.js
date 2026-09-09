import { Router } from "express";
import { query, transaction } from "../db.js";
import { hashPassword, verifyPassword } from "../lib/password.js";
import { signToken } from "../lib/jwt.js";
import { requireAuth } from "../middleware/auth.js";
import { permissionsFor } from "../lib/roles.js";

export const authRouter = Router();

// Versioned sessions are account-wide: this explicitly logs out every device.
authRouter.post('/api/auth/logout-all', requireAuth, async (req, res) => {
  try {
    const revoked = await transaction(async execute => {
      const rows = await execute(`UPDATE dashboard_users
        SET session_version=session_version+1, updated_at=CURRENT_TIMESTAMP
        WHERE id=$1 AND is_active=true AND session_version=$2 RETURNING id`,
      [req.user.id, req.user.session_version]);
      if (rows.length) await execute(`INSERT INTO dashboard_account_audit(actor_id,target_id,action,changes)
        VALUES ($1,$1,'sessions.revoked','{"sessions_revoked":true}'::jsonb)`, [req.user.id]);
      return rows.length > 0;
    });
    if (!revoked) return res.status(401).json({ error: 'session_expired' });
    res.set('Cache-Control', 'no-store');
    return res.json({ ok: true, scope: 'all_sessions' });
  } catch {
    return res.status(503).json({ error: 'session_revocation_unavailable' });
  }
});

authRouter.post("/api/auth/login", async (req, res) => {
  const { email, password } = req.body || {};
  if (typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password) {
    return res.status(400).json({ error: "missing_fields", fields: ["email", "password"] });
  }
  try {
    const [user] = await query(
      `SELECT id, email, password_hash, display_name, role, is_active, session_version
       FROM dashboard_users WHERE LOWER(email) = LOWER($1)`,
      [email.trim()]
    );
    if (!user || !user.is_active) {
      return res.status(401).json({ error: "invalid_credentials" });
    }
    const ok = await verifyPassword(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: "invalid_credentials" });

    await query(
      `UPDATE dashboard_users SET last_login_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
      [user.id]
    );

    const token = signToken(user);
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        role: user.role,
        permissions: permissionsFor(user.role),
      },
    });
  } catch (err) {
    console.error("POST /api/auth/login", err.message);
    res.status(500).json({ error: "login_failed" });
  }
});

authRouter.get("/api/auth/me", requireAuth, async (req, res) => {
  try {
    const [user] = await query(
      `SELECT id, email, display_name, role, is_active, last_login_at, created_at
       FROM dashboard_users WHERE id = $1 AND is_active = true`,
      [req.user.id]
    );
    if (!user) return res.status(401).json({ error: "unauthorized" });
    res.json({ user: { ...user, permissions: permissionsFor(user.role) } });
  } catch (err) {
    console.error("GET /api/auth/me", err.message);
    res.status(500).json({ error: "query_failed" });
  }
});

authRouter.patch("/api/auth/change-password", requireAuth, async (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (typeof current_password !== 'string' || !current_password
    || typeof new_password !== 'string' || new_password.length < 12) {
    return res.status(400).json({ error: "invalid_password" });
  }
  try {
    const [row] = await query(
      `SELECT password_hash FROM dashboard_users WHERE id = $1`,
      [req.user.id]
    );
    if (!row || !(await verifyPassword(current_password, row.password_hash))) {
      return res.status(401).json({ error: "invalid_credentials" });
    }
    const hash = await hashPassword(new_password);
    const updated = await transaction(async execute => {
      const rows = await execute(
        `UPDATE dashboard_users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP
         WHERE id = $2 AND password_hash = $3 AND is_active = true AND session_version = $4 RETURNING id`,
        [hash, req.user.id, row.password_hash, req.user.session_version]);
      if (rows.length) await execute(`INSERT INTO dashboard_account_audit(actor_id,target_id,action,changes)
        VALUES ($1,$1,'password.changed','{"password_changed":true}'::jsonb)`, [req.user.id]);
      return rows;
    });
    if (!updated.length) return res.status(401).json({ error: 'session_expired' });
    res.json({ ok: true });
  } catch (err) {
    console.error("PATCH /api/auth/change-password", err.message);
    res.status(500).json({ error: "update_failed" });
  }
});
