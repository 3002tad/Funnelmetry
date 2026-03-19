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

const kafka = new Kafka({
  clientId: "dashboard-api",
  brokers: (process.env.KAFKA_BOOTSTRAP_SERVERS || "kafka:9092").split(","),
  connectionTimeout: 3000,
  requestTimeout: 5000,
  retry: { retries: 1 },
  logLevel: 0,
});

const kafkaAdmin = kafka.admin();

let alertStore = [];
let simulatedHealth = null;
let smoothedProcessingRate = 0;
let metricsState = {
  httpRequestsTotal: 0,
  cacheHitsTotal: 0,
  cacheMissesTotal: 0,
};

function addAlert(severity, title, message, service) {
  alertStore.unshift({
    id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    severity,
    title,
    message,
    timestamp: new Date().toISOString(),
    service,
  });
  if (alertStore.length > 50) alertStore = alertStore.slice(0, 50);
}

const apiCache = new Map();

async function withCache(key, ttlMs, fn) {
  const now = Date.now();
  const entry = apiCache.get(key);
  if (entry && now < entry.expiresAt) {
    metricsState.cacheHitsTotal += 1;
    return entry.value;
  }
  metricsState.cacheMissesTotal += 1;
  const value = await fn();
  apiCache.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

function renderPrometheusMetrics() {
  return [
    "# HELP dashboard_api_http_requests_total Total HTTP requests handled by dashboard-api",
    "# TYPE dashboard_api_http_requests_total counter",
    `dashboard_api_http_requests_total ${metricsState.httpRequestsTotal}`,
    "# HELP dashboard_api_cache_hits_total TTL cache hits",
    "# TYPE dashboard_api_cache_hits_total counter",
    `dashboard_api_cache_hits_total ${metricsState.cacheHitsTotal}`,
    "# HELP dashboard_api_cache_misses_total TTL cache misses",
    "# TYPE dashboard_api_cache_misses_total counter",
    `dashboard_api_cache_misses_total ${metricsState.cacheMissesTotal}`,
    "# HELP dashboard_api_alerts_total Current alert count",
    "# TYPE dashboard_api_alerts_total gauge",
    `dashboard_api_alerts_total ${alertStore.length}`,
    "# HELP dashboard_api_cache_entries Current cache entry count",
    "# TYPE dashboard_api_cache_entries gauge",
    `dashboard_api_cache_entries ${apiCache.size}`,
    "# HELP dashboard_api_smoothed_processing_rate Current smoothed EPS gauge",
    "# TYPE dashboard_api_smoothed_processing_rate gauge",
    `dashboard_api_smoothed_processing_rate ${smoothedProcessingRate}`,
  ].join("\n");
}

function invalidateCache(...keys) {
  if (keys.length === 0) {
    apiCache.clear();
    return;
  }
  keys.forEach((key) => apiCache.delete(key));
}

setInterval(() => {
  const now = Date.now();
  for (const [key, value] of apiCache.entries()) {
    if (now >= value.expiresAt) apiCache.delete(key);
  }
}, 60000).unref();

app.use(cors());
app.use(express.json());
app.use((req, res, next) => {
  metricsState.httpRequestsTotal += 1;
  next();
});

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

app.get("/health", (req, res) =>
  res.json({ status: "ok", uptime: process.uptime() }),
);

app.get("/metrics", (req, res) => {
  res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(renderPrometheusMetrics());
});

app.get("/api/kpi", async (req, res) => {
  const timeRange = req.query.timeRange || "1h";
  try {
    const data = await withCache(`kpi:${timeRange}`, 3000, async () => {
      const interval = getIntervalExpression(timeRange);
      const result = await pool.query(`
        SELECT
          COALESCE(SUM(revenue), 0)::float AS "revenue",
          COALESCE(SUM(orders_created + payment_initiated + payment_success
                       + payment_failed + order_cancelled), 0)::int AS "totalEvents",
          COALESCE(SUM(payment_success), 0)::int AS "paymentSuccess",
          COALESCE(SUM(orders_created + payment_initiated), 0)::int AS "pending",
          COALESCE(SUM(payment_failed + order_cancelled), 0)::int AS "totalFailed",
          CASE
            WHEN SUM(payment_success) + SUM(payment_failed + order_cancelled) > 0
            THEN ROUND(
              100.0 * SUM(payment_success)
                    / (SUM(payment_success) + SUM(payment_failed + order_cancelled)),
              2)
            ELSE 0
          END::float AS "successRate"
        FROM kpi_1m
        WHERE window_start >= NOW() - INTERVAL '${interval}'
      `);
      return result.rows[0];
    });
    res.json(data);
  } catch (err) {
    console.error("[/api/kpi]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/timeseries", async (req, res) => {
  const timeRange = req.query.timeRange || "1h";
  try {
    const rows = await withCache(`timeseries:${timeRange}`, 4000, async () => {
      const interval = getIntervalExpression(timeRange);
      if (timeRange === "24h") {
        const result = await pool.query(`
          SELECT
            date_trunc('hour', window_start) +
              INTERVAL '30 min' * FLOOR(EXTRACT(MINUTE FROM window_start) / 30) AS "timestamp",
            SUM(revenue)::float AS "revenue",
            SUM(orders_created)::int AS "ordersCreated",
            SUM(payment_success)::int AS "paymentSuccess",
            SUM(payment_failed)::int AS "paymentFailed"
          FROM kpi_1m
          WHERE window_start >= NOW() - INTERVAL '${interval}'
          GROUP BY 1
          ORDER BY 1 ASC
        `);
        return result.rows;
      }

      const result = await pool.query(`
        SELECT
          window_start AS "timestamp",
          revenue::float AS "revenue",
          orders_created::int AS "ordersCreated",
          payment_success::int AS "paymentSuccess",
          payment_failed::int AS "paymentFailed"
        FROM kpi_1m
        WHERE window_start >= NOW() - INTERVAL '${interval}'
        ORDER BY window_start ASC
      `);
      return result.rows;
    });
    res.json(rows);
  } catch (err) {
    console.error("[/api/timeseries]", err.message);
    res.status(500).json({ error: err.message });
  }
});

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
         AND ($2::text IS NULL OR status = $2)`,
      [eventType, status],
    );
    const total = countResult.rows[0].total;

    const statusResult = await pool.query(`
      SELECT
        COALESCE(SUM(payment_success), 0)::int AS success,
        COALESCE(SUM(payment_failed) + SUM(order_cancelled), 0)::int AS failed,
        COALESCE(SUM(orders_created) + SUM(payment_initiated), 0)::int AS pending
      FROM kpi_1m
    `);

    const dataResult = await pool.query(
      `SELECT
         id,
         event_time AS "eventTime",
         event_type AS "eventType",
         order_id AS "orderId",
         user_id AS "userId",
         amount::float,
         currency,
         status
       FROM events_clean
       WHERE ($1::text IS NULL OR event_type = $1)
         AND ($2::text IS NULL OR status = $2)
       ORDER BY event_time DESC
       LIMIT $3 OFFSET $4`,
      [eventType, status, pageSize, offset],
    );

    res.json({
      events: dataResult.rows,
      total,
      page,
      pageSize,
      statusCounts: {
        success: statusResult.rows[0].success,
        failed: statusResult.rows[0].failed,
        pending: statusResult.rows[0].pending,
      },
    });
  } catch (err) {
    console.error("[/api/events]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", async (req, res) => {
  if (simulatedHealth) {
    return res.json(simulatedHealth);
  }

  try {
    const health = await withCache("health", 5000, async () => {
      const h = {
        kafka: { status: "healthy", message: "All brokers operational" },
        spark: { status: "healthy", message: "Streaming jobs running" },
        postgres: { status: "healthy", message: "Database responsive" },
      };

      try {
        await pool.query("SELECT 1");
      } catch (err) {
        h.postgres = { status: "down", message: `Connection failed: ${err.message}` };
      }

      try {
        await kafkaAdmin.connect();
        await kafkaAdmin.listTopics();
        await kafkaAdmin.disconnect();
      } catch (err) {
        h.kafka = { status: "down", message: `Broker unreachable: ${err.message}` };
      }

      if (h.postgres.status === "healthy") {
        try {
          const result = await pool.query(`
            SELECT COUNT(*) AS cnt
            FROM kpi_1m
            WHERE processed_at >= NOW() - INTERVAL '5 minutes'
          `);
          const recent = parseInt(result.rows[0].cnt);
          if (recent === 0) {
            const any = await pool.query("SELECT COUNT(*) AS cnt FROM kpi_1m");
            h.spark = {
              status: "degraded",
              message:
                parseInt(any.rows[0].cnt) > 0
                  ? "No data written in last 5 minutes"
                  : "Waiting for first batch to complete...",
            };
          }
        } catch (_) {
        }
      }

      return h;
    });

    res.json(health);
  } catch (err) {
    console.error("[/api/health]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/metrics", async (req, res) => {
  try {
    const data = await withCache("metrics", 2000, async () => {
      const epsResult = await pool.query(`
        SELECT COUNT(*)::float AS cnt
        FROM events_clean
        WHERE ingest_time >= NOW() - INTERVAL '10 seconds'
      `);
      const instantRate = parseFloat(epsResult.rows[0].cnt) / 10;

      const alpha = 0.35;
      smoothedProcessingRate =
        smoothedProcessingRate === 0
          ? instantRate
          : alpha * instantRate + (1 - alpha) * smoothedProcessingRate;

      const processedEventsPerSec = Math.max(
        0,
        Math.round(smoothedProcessingRate * 10) / 10,
      );

      // NOTE:
      // We do not have Spark consumer-group offsets here, so avoid a fake
      // offset-lag formula. Use ingest delay proxy instead:
      // - pipelineDelaySec: P95 of (ingest_time - event_time) over recent data
      // - kafkaLag: estimated backlog = processedEventsPerSec * pipelineDelaySec
      const delayResult = await pool.query(`
        SELECT
          COALESCE(
            percentile_cont(0.95)
            WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (ingest_time - event_time))),
            0
          )::float AS p95_delay_sec
        FROM events_clean
        WHERE ingest_time >= NOW() - INTERVAL '2 minutes'
          AND event_time  >= NOW() - INTERVAL '2 minutes'
      `);

      const pipelineDelaySec = Math.max(
        0,
        Math.round(parseFloat(delayResult.rows[0].p95_delay_sec || 0) * 10) / 10,
      );

      const kafkaLag = Math.max(
        0,
        Math.round(processedEventsPerSec * pipelineDelaySec),
      );

      return { kafkaLag, processedEventsPerSec, pipelineDelaySec };
    });

    res.json({ ...data, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error("[/api/metrics]", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/alerts", (req, res) => {
  res.json(alertStore);
});

app.post("/api/simulate", (req, res) => {
  const { type } = req.body;
  invalidateCache("health");

  if (type === "reset") {
    simulatedHealth = null;
    addAlert("info", "System Reset", "All systems restored to normal state", "system");
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
    addAlert("critical", "Kafka Cluster Down", "Unable to connect to Kafka brokers", "kafka");
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
    addAlert("critical", "Spark Job Crashed", "Streaming application terminated unexpectedly", "spark");
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

app.listen(PORT, () => {
  console.log(`[dashboard-api] running on port ${PORT}`);
  console.log(
    `[dashboard-api] PostgreSQL → ${process.env.POSTGRES_HOST || "postgres"}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || "realtime"}`,
  );
  console.log(
    `[dashboard-api] Kafka      → ${process.env.KAFKA_BOOTSTRAP_SERVERS || "kafka:9092"}`,
  );
  console.log(`[dashboard-api] Metrics    → http://localhost:${PORT}/metrics`);
});
