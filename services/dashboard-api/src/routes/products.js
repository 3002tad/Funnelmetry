import { Router } from "express";
import { query } from "../db.js";
import { kpiPeriodFilter, periodToJson, resolveAnalyticsPeriod } from "../lib/period.js";

export const productsRouter = Router();

productsRouter.get("/api/products/top", async (req, res) => {
  const period = resolveAnalyticsPeriod(req.query, 60);
  const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);
  const tf = kpiPeriodFilter("k.window_start", period, 1);
  const limitIdx = tf.params.length + 1;
  try {
    const rows = await query(
      `SELECT
         k.product_id,
         COALESCE(c.name,     k.product_id) AS product_name,
         COALESCE(c.price,    0)            AS unit_price,
         COALESCE(c.category, '')           AS category,
         SUM(k.views)        AS views,
         SUM(k.clicks)       AS clicks,
         SUM(k.add_to_cart)  AS add_to_cart,
         SUM(k.remove_from_cart) AS remove_from_cart,
         SUM(k.purchases)    AS purchases,
         SUM(k.revenue)      AS revenue,
         CASE WHEN SUM(k.views) > 0
           THEN ROUND(SUM(k.add_to_cart)::numeric / SUM(k.views), 4)
           ELSE 0 END AS view_to_cart_rate,
         CASE WHEN SUM(k.views) > 0
           THEN ROUND(SUM(k.purchases)::numeric / SUM(k.views), 4)
           ELSE 0 END AS purchase_rate
       FROM product_revenue_kpi_1m k
       LEFT JOIN products_catalog c USING (product_id)
       WHERE 1=1${tf.clause}
       GROUP BY k.product_id, c.name, c.price, c.category
       ORDER BY views DESC
       LIMIT $${limitIdx}`,
      [...tf.params, limit]
    );
    res.json({ ...periodToJson(period), products: rows });
  } catch (err) {
    console.error("GET /api/products/top", err.message);
    res.status(500).json({ error: "query_failed" });
  }
});

productsRouter.get("/api/products/anomalies", async (req, res) => {
  const period = resolveAnalyticsPeriod(req.query, 60);
  const tf = kpiPeriodFilter("k.window_start", period, 1);
  try {
    const rows = await query(
      `SELECT
         k.product_id,
         COALESCE(c.name,  k.product_id) AS product_name,
         COALESCE(c.price, 0)            AS unit_price,
         SUM(k.views)       AS views,
         SUM(k.add_to_cart) AS add_to_cart,
         SUM(k.purchases)   AS purchases,
         CASE WHEN SUM(k.views) > 0
           THEN ROUND(SUM(k.purchases)::numeric / SUM(k.views), 4)
           ELSE 0 END AS purchase_rate
       FROM product_revenue_kpi_1m k
       LEFT JOIN products_catalog c USING (product_id)
       WHERE 1=1${tf.clause}
       GROUP BY k.product_id, c.name, c.price
       HAVING SUM(k.views) >= 5 AND SUM(k.purchases) = 0
       ORDER BY views DESC`,
      tf.params
    );
    res.json({ ...periodToJson(period), anomalies: rows });
  } catch (err) {
    console.error("GET /api/products/anomalies", err.message);
    res.status(500).json({ error: "query_failed" });
  }
});
