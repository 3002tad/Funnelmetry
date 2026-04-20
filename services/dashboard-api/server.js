/**
 * Dashboard API — bootstrap & route mounting.
 * Business logic lives in lib/ and routes/.
 * Port: 8080 (configurable via PORT env)
 */

const express = require("express");
const cors = require("cors");

const { authMiddleware } = require("./lib/auth");
const authRoutes = require("./routes/auth");
const kpiRoutes = require("./routes/kpi");
const timeseriesRoutes = require("./routes/timeseries");
const eventsRoutes = require("./routes/events");
const tracesRoutes = require("./routes/traces");
const healthRoutes = require("./routes/health");
const systemRoutes = require("./routes/system");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors());
app.use(express.json());

// Public — no auth
app.get("/health", (req, res) => res.json({ status: "ok", uptime: process.uptime() }));

// Auth routes manage their own middleware per-route (login is public)
app.use("/api/auth", authRoutes);

// All remaining /api routes require auth
app.use("/api", authMiddleware);

app.use("/api/kpi", kpiRoutes);
app.use("/api/timeseries", timeseriesRoutes);
app.use("/api/events", eventsRoutes);
app.use("/api/traces", tracesRoutes);
app.use("/api", healthRoutes);   // /api/health, /api/metrics
app.use("/api", systemRoutes);   // /api/alerts, /api/simulate

app.listen(PORT, () => {
  console.log(`[dashboard-api] running on port ${PORT}`);
  console.log(
    `[dashboard-api] PostgreSQL → ${process.env.POSTGRES_HOST || "postgres"}:${process.env.POSTGRES_PORT || 5432}/${process.env.POSTGRES_DB || "realtime"}`,
  );
  console.log(`[dashboard-api] Kafka      → ${process.env.KAFKA_BOOTSTRAP_SERVERS || "kafka:9092"}`);
});
