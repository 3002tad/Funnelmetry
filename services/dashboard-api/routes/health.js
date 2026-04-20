const express = require("express");
const { pool, cachedQuery } = require("../lib/db");
const { kafkaAdmin } = require("../lib/kafka");
const { getSimulatedHealth } = require("../lib/state");

const router = express.Router();

// GET /api/health  — checks Kafka, Spark (via PG recency), Postgres
router.get("/health", async (req, res) => {
  const simulated = getSimulatedHealth();
  if (simulated) {
    return res.json(simulated);
  }

  const health = {
    kafka: { status: "healthy", message: "All brokers operational" },
    spark: { status: "healthy", message: "Streaming jobs running" },
    postgres: { status: "healthy", message: "Database responsive" },
  };

  try {
    await pool.query("SELECT 1");
  } catch (err) {
    health.postgres = { status: "down", message: `Connection failed: ${err.message}` };
  }

  try {
    await kafkaAdmin.connect();
    await kafkaAdmin.listTopics();
    await kafkaAdmin.disconnect();
  } catch (err) {
    health.kafka = { status: "down", message: `Broker unreachable: ${err.message}` };
  }

  if (health.postgres.status === "healthy") {
    try {
      const result = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM kpi_1m
        WHERE processed_at >= NOW() - INTERVAL '5 minutes'
      `);
      const recent = parseInt(result.rows[0].cnt);
      if (recent === 0) {
        const any = await pool.query("SELECT COUNT(*) AS cnt FROM kpi_1m");
        if (parseInt(any.rows[0].cnt) > 0) {
          health.spark = { status: "degraded", message: "No data written in last 5 minutes" };
        } else {
          health.spark = { status: "degraded", message: "Waiting for first batch to complete..." };
        }
      }
    } catch (_) {
      /* table might not exist yet */
    }
  }

  res.json(health);
});

// GET /api/metrics
router.get("/metrics", async (req, res) => {
  try {
    const [epsResult, lagResult] = await Promise.all([
      cachedQuery("metrics:eps", () =>
        pool.query(`
          SELECT COUNT(*)::float AS cnt
          FROM events_clean
          WHERE ingest_time >= NOW() - INTERVAL '60 seconds'
        `),
      ),
      cachedQuery("metrics:lag", () =>
        pool.query(`
          SELECT COUNT(*)::int AS cnt
          FROM events_clean
          WHERE ingest_time >= NOW() - INTERVAL '2 minutes'
            AND event_time >= NOW() - INTERVAL '2 minutes'
        `),
      ),
    ]);

    const processedEventsPerSec = Math.round(parseFloat(epsResult.rows[0].cnt) / 60);
    const kafkaLag = Math.max(0, parseInt(lagResult.rows[0].cnt) - processedEventsPerSec * 30);

    res.json({
      kafkaLag,
      processedEventsPerSec,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[/api/metrics]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
