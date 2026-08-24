import { Router } from "express";
import { query } from "../db.js";
import { hashPassword } from "../lib/password.js";
export const usersRouter = Router();

const ROLES = ["super_admin", "analyst"];

usersRouter.get("/api/users", async (_req, res) => {
  try {
    const rows = await query(
      `SELECT id, email, display_name, role, is_active, last_login_at, created_at, updated_at
       FROM dashboard_users ORDER BY created_at DESC`
    );
    res.json({ users: rows });
  } catch (err) {
    console.error("GET /api/users", err.message);
    res.status(500).json({ error: "query_failed" });
  }
});

usersRouter.post("/api/users", async (req, res) => {
  const { email, password, display_name, role } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: "missing_fields", fields: ["email", "password"] });
  }
  if (role && !ROLES.includes(role)) {
    return res.status(400).json({ error: "invalid_role" });
  }
  try {
    const hash = await hashPassword(password);
    const [row] = await query(
      `INSERT INTO dashboard_users (email, password_hash, display_name, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, email, display_name, role, is_active, created_at`,
      [email.trim().toLowerCase(), hash, display_name || null, role || "analyst"]
    );
    res.status(201).json({ user: row });
  } catch (err) {
    if (err.code === "23505") return res.status(409).json({ error: "email_exists" });
    console.error("POST /api/users", err.message);
    res.status(500).json({ error: "create_failed" });
  }
});

usersRouter.patch("/api/users/:id", async (req, res) => {
  const { display_name, role, is_active, password } = req.body || {};
  if (role && !ROLES.includes(role)) {
    return res.status(400).json({ error: "invalid_role" });
  }
  try {
    if (password) {
      const hash = await hashPassword(password);
      await query(
        `UPDATE dashboard_users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [hash, req.params.id]
      );
    }
    const [row] = await query(
      `UPDATE dashboard_users SET
         display_name = COALESCE($1, display_name),
         role = COALESCE($2, role),
         is_active = COALESCE($3, is_active),
         updated_at = CURRENT_TIMESTAMP
       WHERE id = $4
       RETURNING id, email, display_name, role, is_active, last_login_at, updated_at`,
      [
        display_name ?? null,
        role ?? null,
        is_active ?? null,
        req.params.id,
      ]
    );
    if (!row) return res.status(404).json({ error: "not_found" });
    res.json({ user: row });
  } catch (err) {
    console.error("PATCH /api/users/:id", err.message);
    res.status(500).json({ error: "update_failed" });
  }
});

usersRouter.delete("/api/users/:id", async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: "cannot_disable_self" });
  }
  try {
    const [row] = await query(
      `UPDATE dashboard_users SET is_active = false, updated_at = CURRENT_TIMESTAMP
       WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (!row) return res.status(404).json({ error: "not_found" });
    res.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/users/:id", err.message);
    res.status(500).json({ error: "delete_failed" });
  }
});
