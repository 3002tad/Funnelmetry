const express = require("express");
const { pool } = require("../lib/db");
const { getIntervalExpression } = require("../lib/helpers");

const router = express.Router();

// GET /api/traces/stats?timeRange=15m|1h|24h
router.get("/stats", async (req, res) => {
  const timeRange = req.query.timeRange || "1h";
  const interval = getIntervalExpression(timeRange);
  try {
    const result = await pool.query(
      `SELECT
         COUNT(*)::int AS "count",
         ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_total_ms))::int AS "p50",
         ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_total_ms))::int AS "p95",
         ROUND(PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY latency_total_ms))::int AS "p99",
         ROUND(AVG(latency_gen_to_kafka_ms))::int   AS "avgGenToKafkaMs",
         ROUND(AVG(latency_kafka_to_spark_ms))::int  AS "avgKafkaToSparkMs",
         ROUND(AVG(latency_spark_to_db_ms))::int     AS "avgSparkToDbMs"
       FROM event_traces
       WHERE t_generated >= NOW() - $1::interval`,
      [interval],
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[/api/traces/stats]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/traces/timeline?timeRange=1h
router.get("/timeline", async (req, res) => {
  const timeRange = req.query.timeRange || "1h";
  const interval = getIntervalExpression(timeRange);
  try {
    const result = await pool.query(`
      SELECT
        date_trunc('minute', t_generated)${timeRange === "24h" ? `
          - (EXTRACT(MINUTE FROM date_trunc('minute', t_generated))::int % 30) * INTERVAL '1 minute'` : ""}
          AS "timestamp",
        ROUND(PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY latency_total_ms))::int AS "p50",
        ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY latency_total_ms))::int AS "p95",
        COUNT(*)::int AS "count"
      FROM event_traces
      WHERE t_generated >= NOW() - $1::interval
        AND latency_total_ms IS NOT NULL
      GROUP BY 1
      ORDER BY 1 ASC
    `, [interval]);
    res.json(result.rows);
  } catch (err) {
    console.error("[/api/traces/timeline]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
