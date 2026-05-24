import { Router } from "express";
import { query } from "../db.js";

export const healthRouter = Router();

healthRouter.get("/health", async (_req, res) => {
  try {
    await query("SELECT 1");
    res.json({ status: "ok", service: "dashboard-api", postgres: "ok" });
  } catch {
    res.status(503).json({ status: "error", postgres: "unavailable" });
  }
});
