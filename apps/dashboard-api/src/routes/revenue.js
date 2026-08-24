import { Router } from "express";
import { query } from "../db.js";
import { kpiPeriodFilter, periodToJson, resolveAnalyticsPeriod } from "../lib/period.js";

export const revenueRouter = Router();

revenueRouter.get("/api/revenue/summary", async (req, res) => {
  const period = resolveAnalyticsPeriod(req.query, 60);
  const tf = kpiPeriodFilter("window_start", period, 1);
  try {
    const [summary] = await query(
      `SELECT
         COALESCE(SUM(revenue), 0) AS total_revenue,
         COALESCE(SUM(purchases), 0)::int AS total_purchases,
         COALESCE(SUM(checkout_start), 0)::int AS checkout_starts,
         COALESCE(SUM(add_to_cart), 0)::int AS add_to_cart
       FROM tracking_kpi_1m
       WHERE 1=1${tf.clause}`,
      tf.params
    );

    const trend = await query(
      `SELECT window_start, revenue, purchases
       FROM tracking_kpi_1m
       WHERE 1=1${tf.clause}
       ORDER BY window_start ASC`,
      tf.params
    );

    const purchases = Number(summary.total_purchases) || 0;
    const totalRevenue = Number(summary.total_revenue) || 0;

    res.json({
      ...periodToJson(period),
      summary: {
        ...summary,
        average_order_value: purchases > 0 ? Math.round(totalRevenue / purchases) : 0,
        checkout_completion_rate:
          Number(summary.checkout_starts) > 0
            ? Math.round((purchases / Number(summary.checkout_starts)) * 10000) / 10000
            : 0,
      },
      trend,
    });
  } catch (err) {
    console.error("GET /api/revenue/summary", err.message);
    res.status(500).json({ error: "query_failed" });
  }
});

revenueRouter.get("/api/revenue/by-category", async (req, res) => {
  const period = resolveAnalyticsPeriod(req.query, 60);
  const tf = kpiPeriodFilter("k.window_start", period, 1);
  try {
    const rows = await query(
      `SELECT
         COALESCE(c.category, 'unknown') AS category,
         SUM(k.revenue) AS revenue,
         SUM(k.purchases)::int AS purchases,
         SUM(k.views)::int AS views
       FROM product_revenue_kpi_1m k
       LEFT JOIN products_catalog c USING (product_id)
       WHERE 1=1${tf.clause}
       GROUP BY c.category
       ORDER BY revenue DESC`,
      tf.params
    );
    res.json({ ...periodToJson(period), categories: rows });
  } catch (err) {
    console.error("GET /api/revenue/by-category", err.message);
    res.status(500).json({ error: "query_failed" });
  }
});
