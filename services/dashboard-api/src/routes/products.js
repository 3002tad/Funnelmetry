import { Router } from "express";
import { query } from "../db.js";

export const productsRouter = Router();

// GET /api/products/top?minutes=60&limit=10
productsRouter.get("/api/products/top", async (req, res) => {
  const minutes = Math.min(parseInt(req.query.minutes) || 60, 1440);
  const limit = Math.min(parseInt(req.query.limit) || 10, 50);
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
       WHERE k.window_start >= NOW() - ($1 || ' minutes')::interval
       GROUP BY k.product_id, c.name, c.price, c.category
       ORDER BY views DESC
       LIMIT $2`,
      [minutes, limit]
    );
    res.json({ period_minutes: minutes, products: rows });
  } catch (err) {
    console.error("GET /api/products/top", err.message);
    res.status(500).json({ error: "query_failed" });
  }
});

// GET /api/products/anomalies?minutes=60 — high view, low purchase
productsRouter.get("/api/products/anomalies", async (req, res) => {
  const minutes = Math.min(parseInt(req.query.minutes) || 60, 1440);
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
       WHERE k.window_start >= NOW() - ($1 || ' minutes')::interval
       GROUP BY k.product_id, c.name, c.price
       HAVING SUM(k.views) >= 5 AND SUM(k.purchases) = 0
       ORDER BY views DESC`,
      [minutes]
    );
    res.json({ period_minutes: minutes, anomalies: rows });
  } catch (err) {
    console.error("GET /api/products/anomalies", err.message);
    res.status(500).json({ error: "query_failed" });
  }
});
