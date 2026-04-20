const express = require("express");
const { pool, cachedQuery } = require("../lib/db");
const { getIntervalExpression } = require("../lib/helpers");

const router = express.Router();

// GET /api/events?page=1&pageSize=20&eventType=...&status=...
router.get("/", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const pageSize = Math.min(100, parseInt(req.query.pageSize) || 20);
  const offset = (page - 1) * pageSize;
  const eventType = req.query.eventType || null;
  const status = req.query.status || null;
  const search = req.query.search ? req.query.search.trim() : null;
  const sortBy = req.query.sortBy || "event_time";
  const sortDir = req.query.sortDir === "asc" ? "ASC" : "DESC";

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
    const dataParams = [...params, pageSize, offset];

    const [countResult, statusResult, dataResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total FROM events_clean WHERE ${whereClause}`,
        params,
      ),
      cachedQuery("statusCounts", () =>
        pool.query(`
          SELECT
            COALESCE(SUM(payment_success), 0)::int                           AS success,
            COALESCE(SUM(payment_failed) + SUM(order_cancelled), 0)::int     AS failed,
            COALESCE(SUM(orders_created) + SUM(payment_initiated), 0)::int   AS pending
          FROM kpi_1m
        `),
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

    res.json({
      events: dataResult.rows,
      total: countResult.rows[0].total,
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
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/events/export
router.get("/export", async (req, res) => {
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
         id, event_time, event_type, order_id, user_id,
         amount::float, currency, status,
         product_id, product_name, category, quantity,
         payment_method, region
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

// GET /api/events/:id/trace
router.get("/:id/trace", async (req, res) => {
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

// GET /api/events/top-users?timeRange=1h&limit=10
router.get("/top-users", async (req, res) => {
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

// GET /api/events/amount-distribution?timeRange=1h
router.get("/amount-distribution", async (req, res) => {
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

// GET /api/events/scatter?timeRange=1h&limit=200
router.get("/scatter", async (req, res) => {
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

// GET /api/events/revenue-by-type?timeRange=1h
router.get("/revenue-by-type", async (req, res) => {
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

// GET /api/events/heatmap?timeRange=24h
router.get("/heatmap", async (req, res) => {
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

// GET /api/events/by-category?timeRange=1h
router.get("/by-category", async (req, res) => {
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
      `, [interval]),
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[/api/events/by-category]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/events/by-region?timeRange=1h
router.get("/by-region", async (req, res) => {
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
      `, [interval]),
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[/api/events/by-region]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/events/by-payment?timeRange=1h
router.get("/by-payment", async (req, res) => {
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
      `, [interval]),
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[/api/events/by-payment]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/events/top-products?timeRange=1h&limit=10
router.get("/top-products", async (req, res) => {
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
      `, [interval, limit]),
    );
    res.json(result.rows);
  } catch (err) {
    console.error("[/api/events/top-products]", err.message);
    res.status(500).json({ error: "Internal server error" });
  }
});

module.exports = router;
