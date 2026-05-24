import { Router } from "express";
import { query } from "../db.js";

export const funnelRouter = Router();

// GET /api/funnel?minutes=60
// Returns step counts for the conversion funnel.
funnelRouter.get("/api/funnel", async (req, res) => {
  const minutes = Math.min(parseInt(req.query.minutes) || 60, 1440);
  try {
    const [row] = await query(
      `SELECT
         COALESCE(SUM(page_views), 0)     AS page_view,
         COALESCE(SUM(product_views), 0)  AS product_view,
         COALESCE(SUM(add_to_cart), 0)    AS add_to_cart,
         COALESCE(SUM(checkout_start), 0) AS checkout_start,
         COALESCE(SUM(purchases), 0)      AS purchase
       FROM tracking_kpi_1m
       WHERE window_start >= NOW() - ($1 || ' minutes')::interval`,
      [minutes]
    );

    const steps = [
      { step: "page_view",     count: Number(row.page_view) },
      { step: "product_view",  count: Number(row.product_view) },
      { step: "add_to_cart",   count: Number(row.add_to_cart) },
      { step: "checkout_start",count: Number(row.checkout_start) },
      { step: "purchase",      count: Number(row.purchase) },
    ];

    // Drop-off rates
    const funnel = steps.map((s, i) => ({
      ...s,
      drop_off_rate: i === 0 || steps[i - 1].count === 0
        ? 0
        : Number((1 - s.count / steps[i - 1].count).toFixed(4)),
    }));

    res.json({ period_minutes: minutes, funnel });
  } catch (err) {
    console.error("GET /api/funnel", err.message);
    res.status(500).json({ error: "query_failed" });
  }
});
