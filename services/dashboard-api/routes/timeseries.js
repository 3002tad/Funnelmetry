const express = require("express");
const { pool } = require("../lib/db");
const { getIntervalExpression } = require("../lib/helpers");

const router = express.Router();

// GET /api/timeseries?timeRange=15m|1h|24h
router.get("/", async (req, res) => {
  const timeRange = req.query.timeRange || "1h";
  const interval = getIntervalExpression(timeRange);
  try {
    let rows;
    if (timeRange === "24h") {
      const result = await pool.query(`
        SELECT
          date_trunc('hour', window_start) +
            INTERVAL '30 min' * FLOOR(EXTRACT(MINUTE FROM window_start) / 30) AS "timestamp",
          SUM(revenue)::float            AS "revenue",
          SUM(orders_created)::int       AS "ordersCreated",
          SUM(payment_success)::int      AS "paymentSuccess",
          SUM(payment_failed)::int       AS "paymentFailed"
        FROM kpi_1m
        WHERE window_start >= NOW() - $1::interval
        GROUP BY 1
        ORDER BY 1 ASC
      `, [interval]);
      rows = result.rows;
    } else {
      const result = await pool.query(`
        SELECT
          window_start                   AS "timestamp",
          revenue::float                 AS "revenue",
          orders_created::int            AS "ordersCreated",
          payment_success::int           AS "paymentSuccess",
          payment_failed::int            AS "paymentFailed"
        FROM kpi_1m
        WHERE window_start >= NOW() - $1::interval
        ORDER BY window_start ASC
      `, [interval]);
      rows = result.rows;
    }
    res.json(rows);
  } catch (err) {
    console.error("[/api/timeseries]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/timeseries/full?timeRange=15m|1h|24h
router.get("/full", async (req, res) => {
  const timeRange = req.query.timeRange || "1h";
  const interval = getIntervalExpression(timeRange);
  try {
    let rows;
    if (timeRange === "24h") {
      const result = await pool.query(`
        SELECT
          date_trunc('hour', window_start) +
            INTERVAL '30 min' * FLOOR(EXTRACT(MINUTE FROM window_start) / 30) AS "timestamp",
          SUM(revenue)::float              AS "revenue",
          SUM(orders_created)::int         AS "ordersCreated",
          SUM(payment_initiated)::int      AS "paymentInitiated",
          SUM(payment_success)::int        AS "paymentSuccess",
          SUM(payment_failed)::int         AS "paymentFailed",
          SUM(order_cancelled)::int        AS "orderCancelled",
          CASE
            WHEN SUM(payment_success) + SUM(payment_failed + order_cancelled) > 0
            THEN ROUND(100.0 * SUM(payment_success) / (SUM(payment_success) + SUM(payment_failed + order_cancelled)), 2)
            ELSE 0
          END::float AS "successRate"
        FROM kpi_1m
        WHERE window_start >= NOW() - $1::interval
        GROUP BY 1 ORDER BY 1 ASC
      `, [interval]);
      rows = result.rows;
    } else {
      const result = await pool.query(`
        SELECT
          window_start                     AS "timestamp",
          revenue::float                   AS "revenue",
          orders_created::int              AS "ordersCreated",
          payment_initiated::int           AS "paymentInitiated",
          payment_success::int             AS "paymentSuccess",
          payment_failed::int              AS "paymentFailed",
          order_cancelled::int             AS "orderCancelled",
          success_rate::float              AS "successRate"
        FROM kpi_1m
        WHERE window_start >= NOW() - $1::interval
        ORDER BY window_start ASC
      `, [interval]);
      rows = result.rows;
    }
    res.json(rows);
  } catch (err) {
    console.error("[/api/timeseries/full]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
