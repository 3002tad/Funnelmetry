import { Router } from "express";
import { query } from "../db.js";
import { kpiPeriodFilter, periodToJson, resolveAnalyticsPeriod } from "../lib/period.js";

export const searchRouter = Router();

searchRouter.get("/api/search/top", async (req, res) => {
  const period = resolveAnalyticsPeriod(req.query, 60);
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const tf = kpiPeriodFilter("event_time", period, 1);
  const limitIdx = tf.params.length + 1;
  try {
    const rows = await query(
      `SELECT
         COALESCE(metadata->>'query', '') AS query,
         COUNT(*)::int AS searches
       FROM tracking_events_clean
       WHERE event_type = 'search'
         AND COALESCE(metadata->>'query', '') <> ''${tf.clause}
       GROUP BY metadata->>'query'
       ORDER BY searches DESC
       LIMIT $${limitIdx}`,
      [...tf.params, limit]
    );
    res.json({ ...periodToJson(period), searches: rows });
  } catch (err) {
    console.error("GET /api/search/top", err.message);
    res.status(500).json({ error: "query_failed" });
  }
});

searchRouter.get("/api/search/filters", async (req, res) => {
  const period = resolveAnalyticsPeriod(req.query, 60);
  const tf = kpiPeriodFilter("event_time", period, 1);
  try {
    const rows = await query(
      `SELECT
         COUNT(*)::int AS filter_events,
         COALESCE(metadata->'filters'->>'category', metadata->>'category', 'all') AS category,
         COALESCE(metadata->'filters'->>'sortMode', metadata->>'sortMode', '') AS sort_mode
       FROM tracking_events_clean
       WHERE event_type = 'filter_apply'${tf.clause}
       GROUP BY 2, 3
       ORDER BY filter_events DESC
       LIMIT 30`,
      tf.params
    );
    res.json({ ...periodToJson(period), filters: rows });
  } catch (err) {
    console.error("GET /api/search/filters", err.message);
    res.status(500).json({ error: "query_failed" });
  }
});
