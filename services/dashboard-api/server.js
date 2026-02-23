/**
 * Dashboard API
 *
 * Backend service that queries PostgreSQL and checks system health.
 * Serves data to the React frontend dashboard.
 * Port: 8080
 */

const express = require("express");
const cors = require("cors");
const { Pool } = require("pg");
const { Kafka } = require("kafkajs");

const app = express();
const PORT = process.env.PORT || 8080;

// ============================================================================
// DATABASE CONNECTION
// ============================================================================

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "postgres",
  port: parseInt(process.env.POSTGRES_PORT) || 5432,
  database: process.env.POSTGRES_DB || "realtime",
  user: process.env.POSTGRES_USER || "app",
  password: process.env.POSTGRES_PASSWORD || "app",
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// ============================================================================
// KAFKA CLIENT (for health check only)
// ============================================================================

const kafka = new Kafka({
  clientId: "dashboard-api",
  brokers: (process.env.KAFKA_BOOTSTRAP_SERVERS || "kafka:9092").split(","),
  connectionTimeout: 3000,
  requestTimeout: 5000,
  retry: { retries: 1 },
  logLevel: 0, // NOTHING
});

const kafkaAdmin = kafka.admin();

// ============================================================================
// IN-MEMORY ALERT STORE
// ============================================================================

let alertStore = [];
let simulatedHealth = null; // null = use real health

function addAlert(severity, title, message, service) {
  alertStore.unshift({
    id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    severity,
    title,
    message,
    timestamp: new Date().toISOString(),
    service,
  });
  // Keep last 50 alerts
  if (alertStore.length > 50) alertStore = alertStore.slice(0, 50);
}

// ============================================================================
// MIDDLEWARE
// ============================================================================

app.use(cors());
app.use(express.json());

// ============================================================================
// HELPERS
// ============================================================================

function getIntervalExpression(timeRange) {
  switch (timeRange) {
    case "15m":
      return "15 minutes";
    case "1h":
      return "1 hour";
    case "24h":
      return "24 hours";
    default:
      return "1 hour";
  }
}

// For 24h time-series: bucket into 30-min windows to keep ~48 points
// For 1h: return 1-min rows directly (~60 points)
// For 15m: return 1-min rows directly (~15 points)

// ============================================================================
// ROUTES
// ============================================================================

// Health check (internal)
app.get("/health", (req, res) =>
  res.json({ status: "ok", uptime: process.uptime() }),
);

// ----------------------------------------------------------------
// GET /api/kpi?timeRange=15m|1h|24h
// ----------------------------------------------------------------
app.get("/api/kpi", async (req, res) => {
  const timeRange = req.query.timeRange || "1h";
  const interval = getIntervalExpression(timeRange);
  try {
    const result = await pool.query(`
      SELECT
        COALESCE(SUM(revenue), 0)::float           AS "revenue",
        COALESCE(SUM(orders_created), 0)::int      AS "ordersCreated",
        COALESCE(SUM(payment_success), 0)::int     AS "paymentSuccess",
        COALESCE(SUM(payment_failed), 0)::int      AS "paymentFailed",
        CASE
          WHEN SUM(payment_success) + SUM(payment_failed) > 0
          THEN ROUND(100.0 * SUM(payment_success) / (SUM(payment_success) + SUM(payment_failed)), 2)
          ELSE 0
        END::float                                  AS "successRate"
      FROM kpi_1m
      WHERE window_start >= NOW() - INTERVAL '${interval}'
    `);
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[/api/kpi]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// GET /api/timeseries?timeRange=15m|1h|24h
// ----------------------------------------------------------------
app.get("/api/timeseries", async (req, res) => {
  const timeRange = req.query.timeRange || "1h";
  const interval = getIntervalExpression(timeRange);
  try {
    let rows;
    if (timeRange === "24h") {
      // Bucket into 30-minute windows for 24h to avoid too many points
      const result = await pool.query(`
        SELECT
          date_trunc('hour', window_start) + 
            INTERVAL '30 min' * FLOOR(EXTRACT(MINUTE FROM window_start) / 30) AS "timestamp",
          SUM(revenue)::float            AS "revenue",
          SUM(orders_created)::int       AS "ordersCreated",
          SUM(payment_success)::int      AS "paymentSuccess",
          SUM(payment_failed)::int       AS "paymentFailed"
        FROM kpi_1m
        WHERE window_start >= NOW() - INTERVAL '${interval}'
        GROUP BY 1
        ORDER BY 1 ASC
      `);
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
        WHERE window_start >= NOW() - INTERVAL '${interval}'
        ORDER BY window_start ASC
      `);
      rows = result.rows;
    }
    res.json(rows);
  } catch (err) {
    console.error("[/api/timeseries]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// GET /api/events?page=1&pageSize=20&eventType=...&status=...
// ----------------------------------------------------------------
app.get("/api/events", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, parseInt(req.query.pageSize) || 20);
  const offset = (page - 1) * pageSize;
  const eventType = req.query.eventType || null;
  const status = req.query.status || null;

  try {
    const countResult = await pool.query(
      `SELECT COUNT(*)::int AS total
       FROM events_clean
       WHERE ($1::text IS NULL OR event_type = $1)
         AND ($2::text IS NULL OR status      = $2)`,
      [eventType, status],
    );
    const total = countResult.rows[0].total;

    // Status breakdown — use pre-aggregated kpi_1m (Spark output) instead of
    // scanning events_clean. payment_success/payment_failed columns are event-type
    // counts written by Spark; pending = total - success - failed.
    const statusResult = await pool.query(`
      SELECT
        COALESCE(SUM(payment_success), 0)::int AS success,
        COALESCE(SUM(payment_failed),  0)::int AS failed
      FROM kpi_1m
    `);
    const { success: scSuccess, failed: scFailed } = statusResult.rows[0];
    const statusCounts = {
      success: scSuccess,
      failed: scFailed,
      pending: Math.max(0, total - scSuccess - scFailed),
    };

    const dataResult = await pool.query(
      `SELECT
         id,
         event_time  AS "eventTime",
         event_type  AS "eventType",
         order_id    AS "orderId",
         user_id     AS "userId",
         amount::float,
         currency,
         status
       FROM events_clean
       WHERE ($1::text IS NULL OR event_type = $1)
         AND ($2::text IS NULL OR status      = $2)
       ORDER BY event_time DESC
       LIMIT $3 OFFSET $4`,
      [eventType, status, pageSize, offset],
    );

    res.json({
      events: dataResult.rows,
      total,
      page,
      pageSize,
      statusCounts,
    });
  } catch (err) {
    console.error("[/api/events]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// GET /api/health  — checks Kafka, Spark (via PG recency), Postgres
// ----------------------------------------------------------------
app.get("/api/health", async (req, res) => {
  if (simulatedHealth) {
    return res.json(simulatedHealth);
  }

  const health = {
    kafka: { status: "healthy", message: "All brokers operational" },
    spark: { status: "healthy", message: "Streaming jobs running" },
    postgres: { status: "healthy", message: "Database responsive" },
  };

  // Check PostgreSQL
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    health.postgres = {
      status: "down",
      message: `Connection failed: ${err.message}`,
    };
  }

  // Check Kafka
  try {
    await kafkaAdmin.connect();
    await kafkaAdmin.listTopics();
    await kafkaAdmin.disconnect();
  } catch (err) {
    health.kafka = {
      status: "down",
      message: `Broker unreachable: ${err.message}`,
    };
  }

  // Check Spark — verify data was written to kpi_1m in the last 5 minutes
  if (health.postgres.status === "healthy") {
    try {
      const result = await pool.query(`
        SELECT COUNT(*) AS cnt
        FROM kpi_1m
        WHERE processed_at >= NOW() - INTERVAL '5 minutes'
      `);
      const recent = parseInt(result.rows[0].cnt);
      if (recent === 0) {
        // Check if there's any data at all
        const any = await pool.query("SELECT COUNT(*) AS cnt FROM kpi_1m");
        if (parseInt(any.rows[0].cnt) > 0) {
          health.spark = {
            status: "degraded",
            message: "No data written in last 5 minutes",
          };
        } else {
          health.spark = {
            status: "degraded",
            message: "Waiting for first batch to complete...",
          };
        }
      }
    } catch (_) {
      /* table might not exist yet */
    }
  }

  res.json(health);
});

// ----------------------------------------------------------------
// GET /api/metrics
// ----------------------------------------------------------------
app.get("/api/metrics", async (req, res) => {
  try {
    // Events processed per second = events in last 60s / 60
    const epsResult = await pool.query(`
      SELECT COUNT(*)::float AS cnt
      FROM events_clean
      WHERE ingest_time >= NOW() - INTERVAL '60 seconds'
    `);
    const processedEventsPerSec = Math.round(
      parseFloat(epsResult.rows[0].cnt) / 60,
    );

    // Kafka lag: approximate as events in events_clean vs expected
    // (simple heuristic — events generated but not yet in kpi_1m within last 2 min)
    const lagResult = await pool.query(`
      SELECT COUNT(*)::int AS cnt
      FROM events_clean
      WHERE ingest_time >= NOW() - INTERVAL '2 minutes'
        AND event_time >= NOW() - INTERVAL '2 minutes'
    `);
    const kafkaLag = Math.max(
      0,
      parseInt(lagResult.rows[0].cnt) - processedEventsPerSec * 30,
    );

    res.json({
      kafkaLag,
      processedEventsPerSec,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[/api/metrics]", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------------------
// GET /api/alerts
// ----------------------------------------------------------------
app.get("/api/alerts", (req, res) => {
  res.json(alertStore);
});

// ----------------------------------------------------------------
// POST /api/simulate  { type: 'kafka_down' | 'spark_crash' | 'reset' }
// ----------------------------------------------------------------
app.post("/api/simulate", (req, res) => {
  const { type } = req.body;

  if (type === "reset") {
    simulatedHealth = null;
    addAlert(
      "info",
      "System Reset",
      "All systems restored to normal state",
      "system",
    );
  } else if (type === "kafka_down") {
    simulatedHealth = simulatedHealth
      ? {
          ...simulatedHealth,
          kafka: {
            status: "down",
            message: "Connection timeout - brokers unreachable",
          },
        }
      : {
          kafka: {
            status: "down",
            message: "Connection timeout - brokers unreachable",
          },
          spark: { status: "degraded", message: "Cannot consume from Kafka" },
          postgres: { status: "healthy", message: "Database responsive" },
        };
    addAlert(
      "critical",
      "Kafka Cluster Down",
      "Unable to connect to Kafka brokers",
      "kafka",
    );
  } else if (type === "spark_crash") {
    simulatedHealth = simulatedHealth
      ? {
          ...simulatedHealth,
          spark: {
            status: "down",
            message: "Streaming job failed - OOM error",
          },
        }
      : {
          kafka: { status: "healthy", message: "All brokers operational" },
          spark: {
            status: "down",
            message: "Streaming job failed - OOM error",
          },
          postgres: { status: "healthy", message: "Database responsive" },
        };
    addAlert(
      "critical",
      "Spark Job Crashed",
      "Streaming application terminated unexpectedly",
      "spark",
    );
  } else {
    return res.status(400).json({ error: "Unknown simulation type" });
  }

  res.json(
    simulatedHealth || {
      kafka: { status: "healthy", message: "All brokers operational" },
      spark: { status: "healthy", message: "Streaming jobs running" },
      postgres: { status: "healthy", message: "Database responsive" },
    },
  );
});

// ============================================================================
// START
// ============================================================================

app.listen(PORT, () => {
  console.log(`[dashboard-api] running on port ${PORT}`);
  console.log(
    `[dashboard-api] PostgreSQL → ${process.env.POSTGRES_HOST || "postgres"}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || "realtime"}`,
  );
  console.log(
    `[dashboard-api] Kafka      → ${process.env.KAFKA_BOOTSTRAP_SERVERS || "kafka:9092"}`,
  );
});
