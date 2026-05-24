import { Router } from "express";
import { query } from "../db.js";

export const revenueRouter = Router();

revenueRouter.get("/api/revenue/summary", async (req, res) => {
  const minutes = Math.min(parseInt(req.query.minutes) || 60, 1440);
  try {
    const [summary] = await query(
      `SELECT
         COALESCE(SUM(revenue), 0) AS total_revenue,
         COALESCE(SUM(purchases), 0)::int AS total_purchases,
         COALESCE(SUM(checkout_start), 0)::int AS checkout_starts,
         COALESCE(SUM(add_to_cart), 0)::int AS add_to_cart
       FROM product_revenue_kpi_1m
       WHERE window_start >= NOW() - ($1 || ' minutes')::interval`,
      [minutes]
    );

    const trend = await query(
      `SELECT
         window_start,
         SUM(revenue) AS revenue,
         SUM(purchases)::int AS purchases
       FROM product_revenue_kpi_1m
       WHERE window_start >= NOW() - ($1 || ' minutes')::interval
       GROUP BY window_start
       ORDER BY window_start ASC`,
      [minutes]
    );

    const purchases = Number(summary.total_purchases) || 0;
    const totalRevenue = Number(summary.total_revenue) || 0;

    res.json({
      period_minutes: minutes,
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
  const minutes = Math.min(parseInt(req.query.minutes) || 60, 1440);
  try {
    const rows = await query(
      `SELECT
         COALESCE(c.category, 'unknown') AS category,
         SUM(k.revenue) AS revenue,
         SUM(k.purchases)::int AS purchases,
         SUM(k.views)::int AS views
       FROM product_revenue_kpi_1m k
       LEFT JOIN products_catalog c USING (product_id)
       WHERE k.window_start >= NOW() - ($1 || ' minutes')::interval
       GROUP BY c.category
       ORDER BY revenue DESC`,
      [minutes]
    );
    res.json({ period_minutes: minutes, categories: rows });
  } catch (err) {
    console.error("GET /api/revenue/by-category", err.message);
    res.status(500).json({ error: "query_failed" });
  }
});
