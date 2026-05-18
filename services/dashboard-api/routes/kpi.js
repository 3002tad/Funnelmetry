const express = require("express");
const { pool, cachedQuery } = require("../lib/db");
const { getIntervalExpression } = require("../lib/helpers");

const router = express.Router();

// GET /api/kpi?timeRange=15m|1h|24h
router.get("/", async (req, res) => {
  const timeRange = req.query.timeRange || "1h";
  const interval = getIntervalExpression(timeRange);
  try {
    const result = await cachedQuery(`kpi:${timeRange}`, () =>
      pool.query(`
        SELECT
          COALESCE(SUM(revenue), 0)::float                                              AS "revenue",
          COALESCE(SUM(orders_created + payment_initiated + payment_success
                       + payment_failed + order_cancelled), 0)::int                     AS "totalEvents",
          COALESCE(SUM(payment_success), 0)::int                                        AS "paymentSuccess",
          COALESCE(SUM(orders_created + payment_initiated), 0)::int                     AS "pending",
          COALESCE(SUM(payment_failed + order_cancelled), 0)::int                       AS "totalFailed",
          CASE
            WHEN SUM(payment_success) + SUM(payment_failed + order_cancelled) > 0
            THEN ROUND(
              100.0 * SUM(payment_success)
                    / (SUM(payment_success) + SUM(payment_failed + order_cancelled)),
              2)
            ELSE 0
          END::float                                                                    AS "successRate"
        FROM kpi_1m
        WHERE window_start >= NOW() - $1::interval
      `, [interval]),
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[/api/kpi]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
