import { Router } from "express";
import { query } from "../db.js";

export const bannersRouter = Router();

bannersRouter.get("/api/banners", async (req, res) => {
  const minutes = Math.min(parseInt(req.query.minutes) || 60, 1440);
  try {
    const rows = await query(
      `SELECT
         banner_id,
         SUM(impressions)::int AS impressions,
         SUM(clicks)::int AS clicks,
         CASE WHEN SUM(impressions) > 0
           THEN ROUND(SUM(clicks)::numeric / SUM(impressions), 4)
           ELSE 0 END AS ctr,
         MAX(target_product_id) AS target_product_id
       FROM banner_kpi_1m
       WHERE window_start >= NOW() - ($1 || ' minutes')::interval
       GROUP BY banner_id
       ORDER BY impressions DESC`,
      [minutes]
    );
    res.json({ period_minutes: minutes, banners: rows });
  } catch (err) {
    console.error("GET /api/banners", err.message);
    res.status(500).json({ error: "query_failed" });
  }
});
