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
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

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
  max: 30,                      // was 10 — more concurrent queries
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,     // kill slow queries after 10s
});

// ============================================================================
// IN-MEMORY QUERY CACHE (TTL-based, avoids redundant DB hits)
// ============================================================================

const queryCache = new Map();
const CACHE_TTL_MS = parseInt(process.env.CACHE_TTL_MS) || 3000; // 3s default

function cachedQuery(key, queryFn) {
  const now = Date.now();
  const cached = queryCache.get(key);
  if (cached && (now - cached.ts) < CACHE_TTL_MS) {
    return cached.promise;
  }
  const promise = queryFn();
  queryCache.set(key, { promise, ts: now });
  // Auto-cleanup to prevent memory leak
  promise.catch(() => queryCache.delete(key));
  return promise;
}

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
// AUTH CONFIGURATION
// ============================================================================

const JWT_SECRET = process.env.JWT_SECRET || "realtime-dashboard-secret-key-2026";
const JWT_EXPIRES_IN = "24h";

// Default users (seeded on startup)
const DEFAULT_USERS = [
  { username: "admin", password: "admin123", displayName: "Admin", role: "admin" },
  { username: "viewer", password: "viewer123", displayName: "Viewer", role: "viewer" },
];

// In-memory user store (seeded from defaults + can be extended)
let userStore = [];

async function seedUsers() {
  for (const u of DEFAULT_USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    userStore.push({
      id: `user_${u.username}`,
      username: u.username,
      passwordHash: hash,
      displayName: u.displayName,
      role: u.role,
      createdAt: new Date().toISOString(),
    });
  }
  console.log(`[auth] Seeded ${userStore.length} default users`);
}

// Seed users before server starts accepting requests (awaited in startup)
let usersReady = seedUsers();

// JWT auth middleware
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }
  const token = authHeader.slice(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
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

// Health check (internal — no auth)
app.get("/health", (req, res) =>
  res.json({ status: "ok", uptime: process.uptime() }),
);

// ----------------------------------------------------------------
// AUTH ROUTES (no auth required)
// ----------------------------------------------------------------

// POST /api/auth/login
app.post("/api/auth/login", async (req, res) => {
  await usersReady; // ensure users are seeded before first login
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  const user = userStore.find((u) => u.username === username);
  if (!user) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    },
  });
});

// GET /api/auth/me — verify token & return user info
app.get("/api/auth/me", authMiddleware, (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    displayName: req.user.displayName,
    role: req.user.role,
  });
});

// POST /api/auth/register (admin only)
app.post("/api/auth/register", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only admins can register new users" });
  }

  const { username, password, displayName, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  const validRoles = ["admin", "viewer"];
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(", ")}` });
  }

  if (userStore.find((u) => u.username === username)) {
    return res.status(409).json({ error: "Username already exists" });
  }

  const hash = await bcrypt.hash(password, 10);
  const newUser = {
    id: `user_${username}`,
    username,
    passwordHash: hash,
    displayName: displayName || username,
    role: role || "viewer",
    createdAt: new Date().toISOString(),
  };
  userStore.push(newUser);

  res.status(201).json({
    id: newUser.id,
    username: newUser.username,
    displayName: newUser.displayName,
    role: newUser.role,
  });
});

// ----------------------------------------------------------------
// PROTECTED API ROUTES — all routes below require auth
// ----------------------------------------------------------------
app.use("/api", authMiddleware);

// ----------------------------------------------------------------
// GET /api/kpi?timeRange=15m|1h|24h
// ----------------------------------------------------------------
app.get("/api/kpi", async (req, res) => {
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
      `, [interval])
    );
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[/api/kpi]", err.message);
    res.status(500).json({ error: "Internal server error" });
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

// ----------------------------------------------------------------
// GET /api/events?page=1&pageSize=20&eventType=...&status=...
// ----------------------------------------------------------------
app.get("/api/events", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, parseInt(req.query.pageSize) || 20);
  const offset = (page - 1) * pageSize;
  const eventType = req.query.eventType || null;
  const status = req.query.status || null;
  const search = req.query.search ? req.query.search.trim() : null;
  const sortBy = req.query.sortBy || "event_time";
  const sortDir = req.query.sortDir === "asc" ? "ASC" : "DESC";

  // Whitelist sortable columns
  const sortColumns = {
    event_time: "event_time",
    event_type: "event_type",
    user_id: "user_id",
    amount: "amount",
    status: "status",
  };
  const sortColumn = sortColumns[sortBy] || "event_time";

  try {
    const whereConditions = [
      "($1::text IS NULL OR event_type = $1)",
      "($2::text IS NULL OR status = $2)",
    ];
    const params = [eventType, status];

    if (search) {
      params.push(`%${search}%`);
      whereConditions.push(
        `(user_id ILIKE $${params.length} OR order_id ILIKE $${params.length} OR id ILIKE $${params.length})`
      );
    }

    const whereClause = whereConditions.join(" AND ");

    // Run count + data + status queries in PARALLEL (was sequential = 3x slower)
    const dataParams = [...params, pageSize, offset];
    const [countResult, statusResult, dataResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total FROM events_clean WHERE ${whereClause}`,
        params,
      ),
      // Cached status breakdown — same for all users within TTL
      cachedQuery('statusCounts', () =>
        pool.query(`
          SELECT
            COALESCE(SUM(payment_success), 0)::int                           AS success,
            COALESCE(SUM(payment_failed) + SUM(order_cancelled), 0)::int     AS failed,
            COALESCE(SUM(orders_created) + SUM(payment_initiated), 0)::int   AS pending
          FROM kpi_1m
        `)
      ),
      pool.query(
        `SELECT
           id,
           event_time     AS "eventTime",
           event_type     AS "eventType",
           order_id       AS "orderId",
           user_id        AS "userId",
           amount::float,
           currency,
           status,
           product_id     AS "productId",
           product_name   AS "productName",
           category,
           quantity,
           payment_method AS "paymentMethod",
           region
         FROM events_clean
         WHERE ${whereClause}
         ORDER BY ${sortColumn} ${sortDir}
         LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`,
        dataParams,
      ),
    ]);
    const total = countResult.rows[0].total;
    const statusCounts = {
      success: statusResult.rows[0].success,
      failed:  statusResult.rows[0].failed,
      pending: statusResult.rows[0].pending,
    };

    res.json({
      events: dataResult.rows,
      total,
      page,
      pageSize,
      statusCounts,
    });
  } catch (err) {
    console.error("[/api/events]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----------------------------------------------------------------
// GET /api/events/export?eventType=...&status=...&search=...
// Export all matching events as CSV
// ----------------------------------------------------------------
app.get("/api/events/export", async (req, res) => {
  const eventType = req.query.eventType || null;
  const status = req.query.status || null;
  const search = req.query.search ? req.query.search.trim() : null;

  try {
    const whereConditions = [
      "($1::text IS NULL OR event_type = $1)",
      "($2::text IS NULL OR status = $2)",
    ];
    const params = [eventType, status];

    if (search) {
      params.push(`%${search}%`);
      whereConditions.push(
        `(user_id ILIKE $${params.length} OR order_id ILIKE $${params.length} OR id ILIKE $${params.length})`
      );
    }

    const whereClause = whereConditions.join(" AND ");
    const result = await pool.query(
      `SELECT
         id,
         event_time,
         event_type,
         order_id,
         user_id,
         amount::float,
         currency,
         status,
         product_id,
         product_name,
         category,
         quantity,
         payment_method,
         region
       FROM events_clean
       WHERE ${whereClause}
       ORDER BY event_time DESC
       LIMIT 10000`,
      params,
    );

    const esc = (val) => {
      const s = String(val == null ? "" : val);
      if (s.includes('"') || s.includes(",") || s.includes("\n") || s.startsWith("=") || s.startsWith("+") || s.startsWith("-") || s.startsWith("@")) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const header = "id,event_time,event_type,order_id,user_id,amount,currency,status,product_id,product_name,category,quantity,payment_method,region";
    const rows = result.rows.map(r =>
      [r.id, r.event_time, r.event_type, r.order_id, r.user_id, r.amount, r.currency, r.status,
       r.product_id, r.product_name, r.category, r.quantity, r.payment_method, r.region].map(esc).join(",")
    );
    const csv = [header, ...rows].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="events_export_${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    console.error("[/api/events/export]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----------------------------------------------------------------
// GET /api/events/:id/trace — distributed tracing for a single event
// ----------------------------------------------------------------
app.get("/api/events/:id/trace", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         event_id                  AS "eventId",
         t_generated               AS "tGenerated",
         t_kafka_sent              AS "tKafkaSent",
         t_spark_processed         AS "tSparkProcessed",
         t_db_written              AS "tDbWritten",
         latency_gen_to_kafka_ms   AS "latencyGenToKafkaMs",
         latency_kafka_to_spark_ms AS "latencyKafkaToSparkMs",
         latency_spark_to_db_ms    AS "latencySparkToDbMs",
         latency_total_ms          AS "latencyTotalMs"
       FROM event_traces
       WHERE event_id = $1`,
      [req.params.id],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Trace not found" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    console.error("[/api/events/:id/trace]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----------------------------------------------------------------
// GET /api/traces/stats?timeRange=15m|1h|24h — latency percentiles
// ----------------------------------------------------------------
app.get("/api/traces/stats", async (req, res) => {
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
    // Cached: both queries run in parallel
    const [epsResult, lagResult] = await Promise.all([
      cachedQuery('metrics:eps', () =>
        pool.query(`
          SELECT COUNT(*)::float AS cnt
          FROM events_clean
          WHERE ingest_time >= NOW() - INTERVAL '60 seconds'
        `)
      ),
      cachedQuery('metrics:lag', () =>
        pool.query(`
          SELECT COUNT(*)::int AS cnt
          FROM events_clean
          WHERE ingest_time >= NOW() - INTERVAL '2 minutes'
            AND event_time >= NOW() - INTERVAL '2 minutes'
        `)
      ),
    ]);

    const processedEventsPerSec = Math.round(
      parseFloat(epsResult.rows[0].cnt) / 60,
    );
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
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----------------------------------------------------------------
// GET /api/timeseries/full?timeRange=15m|1h|24h
// All 5 event types + success_rate over time
// ----------------------------------------------------------------
app.get("/api/timeseries/full", async (req, res) => {
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

// ----------------------------------------------------------------
// GET /api/events/top-users?timeRange=1h&limit=10
// ----------------------------------------------------------------
app.get("/api/events/top-users", async (req, res) => {
  const timeRange = req.query.timeRange || "1h";
  const limit = Math.min(20, parseInt(req.query.limit) || 10);
  const interval = getIntervalExpression(timeRange);
  try {
    const result = await pool.query(`
      SELECT
        user_id                         AS "userId",
        COUNT(*)::int                   AS "eventCount",
        SUM(amount)::float              AS "totalAmount",
        SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::int AS "successCount",
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END)::int  AS "failedCount"
      FROM events_clean
      WHERE ingest_time >= NOW() - $1::interval
      GROUP BY user_id
      ORDER BY "eventCount" DESC
      LIMIT $2
    `, [interval, limit]);
    res.json(result.rows);
  } catch (err) {
    console.error("[/api/events/top-users]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----------------------------------------------------------------
// GET /api/events/amount-distribution?timeRange=1h
// ----------------------------------------------------------------
app.get("/api/events/amount-distribution", async (req, res) => {
  const timeRange = req.query.timeRange || "1h";
  const interval = getIntervalExpression(timeRange);
  try {
    const result = await pool.query(`
      SELECT
        CASE
          WHEN amount = 0 THEN '0'
          WHEN amount < 100000 THEN '< 100K'
          WHEN amount < 500000 THEN '100K-500K'
          WHEN amount < 1000000 THEN '500K-1M'
          WHEN amount < 3000000 THEN '1M-3M'
          ELSE '3M+'
        END AS "range",
        COUNT(*)::int AS "count"
      FROM events_clean
      WHERE ingest_time >= NOW() - $1::interval
      GROUP BY 1
      ORDER BY MIN(amount) ASC
    `, [interval]);
    res.json(result.rows);
  } catch (err) {
    console.error("[/api/events/amount-distribution]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----------------------------------------------------------------
// GET /api/traces/timeline?timeRange=1h
// Latency percentiles over time (bucketed)
// ----------------------------------------------------------------
app.get("/api/traces/timeline", async (req, res) => {
  const timeRange = req.query.timeRange || "1h";
  const interval = getIntervalExpression(timeRange);
  try {
    const bucketInterval = timeRange === "24h" ? "30 minutes" : "1 minute";
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

// ----------------------------------------------------------------
// GET /api/events/scatter?timeRange=1h&limit=200
// Amount vs Latency scatter data
// ----------------------------------------------------------------
app.get("/api/events/scatter", async (req, res) => {
  const timeRange = req.query.timeRange || "1h";
  const limit = Math.min(500, parseInt(req.query.limit) || 200);
  const interval = getIntervalExpression(timeRange);
  try {
    const result = await pool.query(`
      SELECT
        e.amount::float        AS "amount",
        t.latency_total_ms::int AS "latency",
        e.event_type           AS "eventType",
        e.status               AS "status"
      FROM events_clean e
      JOIN event_traces t ON e.id = t.event_id
      WHERE e.ingest_time >= NOW() - $1::interval
        AND t.latency_total_ms IS NOT NULL
      ORDER BY e.ingest_time DESC
      LIMIT $2
    `, [interval, limit]);
    res.json(result.rows);
  } catch (err) {
    console.error("[/api/events/scatter]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----------------------------------------------------------------
// GET /api/events/revenue-by-type?timeRange=1h
// Revenue breakdown by event type
// ----------------------------------------------------------------
app.get("/api/events/revenue-by-type", async (req, res) => {
  const timeRange = req.query.timeRange || "1h";
  const interval = getIntervalExpression(timeRange);
  try {
    const result = await pool.query(`
      SELECT
        event_type      AS "eventType",
        COUNT(*)::int   AS "count",
        SUM(amount)::float AS "revenue"
      FROM events_clean
      WHERE ingest_time >= NOW() - $1::interval
      GROUP BY event_type
      ORDER BY "revenue" DESC
    `, [interval]);
    res.json(result.rows);
  } catch (err) {
    console.error("[/api/events/revenue-by-type]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----------------------------------------------------------------
// GET /api/events/heatmap?timeRange=24h
// Event density by hour of day
// ----------------------------------------------------------------
app.get("/api/events/heatmap", async (req, res) => {
  const timeRange = req.query.timeRange || "24h";
  const interval = getIntervalExpression(timeRange);
  try {
    const result = await pool.query(`
      SELECT
        EXTRACT(HOUR FROM event_time)::int AS "hour",
        event_type                         AS "eventType",
        COUNT(*)::int                      AS "count"
      FROM events_clean
      WHERE ingest_time >= NOW() - $1::interval
      GROUP BY 1, 2
      ORDER BY 1 ASC, 2 ASC
    `, [interval]);
    res.json(result.rows);
  } catch (err) {
    console.error("[/api/events/heatmap]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----------------------------------------------------------------
// GET /api/events/by-category?timeRange=1h
// Revenue & order count grouped by product category
// ----------------------------------------------------------------
app.get("/api/events/by-category", async (req, res) => {
  const timeRange = req.query.timeRange || "1h";
  const interval = getIntervalExpression(timeRange);
  try {
    const result = await cachedQuery(`category:${timeRange}`, () =>
      pool.query(`
        SELECT
          COALESCE(category, 'unknown')   AS "category",
          COUNT(*)::int                   AS "count",
          SUM(amount)::float              AS "revenue",
          SUM(quantity)::int              AS "totalQuantity"
        FROM events_clean
        WHERE ingest_time >= NOW() - $1::interval
          AND category IS NOT NULL
        GROUP BY category
        ORDER BY "revenue" DESC
      `, [interval])
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[/api/events/by-category]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----------------------------------------------------------------
// GET /api/events/by-region?timeRange=1h
// Order count & revenue grouped by region
// ----------------------------------------------------------------
app.get("/api/events/by-region", async (req, res) => {
  const timeRange = req.query.timeRange || "1h";
  const interval = getIntervalExpression(timeRange);
  try {
    const result = await cachedQuery(`region:${timeRange}`, () =>
      pool.query(`
        SELECT
          region                          AS "region",
          COUNT(*)::int                   AS "count",
          SUM(amount)::float              AS "revenue",
          SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)::int AS "successCount"
        FROM events_clean
        WHERE ingest_time >= NOW() - $1::interval
          AND region IS NOT NULL
        GROUP BY region
        ORDER BY "count" DESC
      `, [interval])
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[/api/events/by-region]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----------------------------------------------------------------
// GET /api/events/by-payment?timeRange=1h
// Transaction count & success rate by payment method
// ----------------------------------------------------------------
app.get("/api/events/by-payment", async (req, res) => {
  const timeRange = req.query.timeRange || "1h";
  const interval = getIntervalExpression(timeRange);
  try {
    const result = await cachedQuery(`payment:${timeRange}`, () =>
      pool.query(`
        SELECT
          payment_method                   AS "paymentMethod",
          COUNT(*)::int                    AS "count",
          SUM(amount)::float               AS "revenue",
          ROUND(100.0 * SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END)
            / NULLIF(COUNT(*), 0), 1)::float AS "successRate"
        FROM events_clean
        WHERE ingest_time >= NOW() - $1::interval
          AND payment_method IS NOT NULL
        GROUP BY payment_method
        ORDER BY "count" DESC
      `, [interval])
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[/api/events/by-payment]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ----------------------------------------------------------------
// GET /api/events/top-products?timeRange=1h&limit=10
// Top products by revenue
// ----------------------------------------------------------------
app.get("/api/events/top-products", async (req, res) => {
  const timeRange = req.query.timeRange || "1h";
  const limit = Math.min(20, parseInt(req.query.limit) || 10);
  const interval = getIntervalExpression(timeRange);
  try {
    const result = await cachedQuery(`top-products:${timeRange}:${limit}`, () =>
      pool.query(`
        SELECT
          product_id                       AS "productId",
          product_name                     AS "productName",
          category                         AS "category",
          COUNT(*)::int                    AS "orderCount",
          SUM(quantity)::int               AS "totalQuantity",
          SUM(amount)::float               AS "revenue"
        FROM events_clean
        WHERE ingest_time >= NOW() - $1::interval
          AND product_id IS NOT NULL
          AND status = 'success'
        GROUP BY product_id, product_name, category
        ORDER BY "revenue" DESC
        LIMIT $2
      `, [interval, limit])
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[/api/events/top-products]", err.message);
    res.status(500).json({ error: "Internal server error" });
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
