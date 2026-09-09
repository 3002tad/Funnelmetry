import { Router } from "express";
import { query } from "../db.js";
import { verifyToken } from "../lib/jwt.js";
import { eventBus } from "../lib/event-bus.js";
import { attachGuardedSse } from '../lib/guarded-sse.js';

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

/**
 * GET /api/events/stream?token=<jwt>
 *
 * Server-Sent Events stream. Pushes new tracking events in real time.
 * EventSource (browser) cannot set Authorization header, so we accept
 * the JWT as a query param instead.
 *
 * Message format:
 *   event: events
 *   data: [{event_id, event_time, event_type, ...}, ...]
 *
 *   event: ping
 *   data: {"ts":"<iso>"}
 */
eventsRouter.get("/api/events/stream", (req, res) => {
  // Auth: query param token (EventSource can't set Authorization header).
  const token = req.headers.authorization?.startsWith('Bearer ')
    ? req.headers.authorization.slice(7) : req.query.token;
  if (!token) return res.status(401).json({ error: "unauthorized" });
  let claims;
  try {
    claims = verifyToken(token);
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();

  attachGuardedSse({ req, res, bus: eventBus, claims, execute: query });
});
