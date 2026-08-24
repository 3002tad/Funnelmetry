import { Router } from "express";
import { query } from "../db.js";
import { kpiPeriodFilter, periodToJson, resolveAnalyticsPeriod } from "../lib/period.js";

export const overviewRouter = Router();

// GET /api/overview?minutes=30 | ?date=YYYY-MM-DD
overviewRouter.get("/api/overview", async (req, res) => {
  const period = resolveAnalyticsPeriod(req.query, 30);
  const tf = kpiPeriodFilter("t.window_start", period, 1);
  const tfTrend = kpiPeriodFilter("window_start", period, 1);
  try {
    const [agg] = await query(
      `SELECT
         COALESCE(SUM(t.total_events), 0)   AS total_events,
         COALESCE(SUM(t.page_views), 0)     AS page_views,
         COALESCE(SUM(t.product_views), 0)  AS product_views,
         COALESCE(SUM(t.clicks), 0)         AS clicks,
         COALESCE(SUM(t.searches), 0)       AS searches,
         COALESCE(SUM(t.add_to_cart), 0)    AS add_to_cart,
         COALESCE(SUM(t.remove_from_cart), 0) AS remove_from_cart,
         COALESCE(SUM(t.checkout_start), 0) AS checkout_start,
         COALESCE(SUM(t.purchases), 0)      AS purchases,
         COALESCE(SUM(t.unique_sessions), 0) AS unique_sessions,
         CASE WHEN SUM(t.unique_sessions) > 0
           THEN ROUND(SUM(t.purchases)::numeric / SUM(t.unique_sessions), 4)
           ELSE 0
         END AS conversion_rate,
         COALESCE(SUM(t.revenue), 0) AS total_revenue
       FROM tracking_kpi_1m t
       WHERE 1=1${tf.clause}`,
      tf.params
    );

    const trend = await query(
      `SELECT
         window_start,
         total_events, page_views, product_views, searches,
         add_to_cart, purchases, unique_sessions, revenue
       FROM tracking_kpi_1m
       WHERE 1=1${tfTrend.clause}
       ORDER BY window_start ASC`,
      tfTrend.params
    );

    res.json({ ...periodToJson(period), kpi: agg, trend });
  } catch (err) {
    console.error("GET /api/overview", err.message);
    res.status(500).json({ error: "query_failed" });
  }
});
