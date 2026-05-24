import { Router } from "express";
import { query } from "../db.js";

export const eventsRouter = Router();

// GET /api/events/recent?limit=50
eventsRouter.get("/api/events/recent", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  try {
    const rows = await query(
      `SELECT event_id, event_time, event_type, event_category,
              anonymous_id, session_id, page_url, product_id, metadata
       FROM tracking_events_clean
       ORDER BY event_time DESC
       LIMIT $1`,
      [limit]
    );
    res.json({ events: rows });
  } catch (err) {
    console.error("GET /api/events/recent", err.message);
    res.status(500).json({ error: "query_failed" });
  }
});
