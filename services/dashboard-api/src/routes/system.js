import { Router } from "express";
import { config } from "../config.js";
import { getOllamaHealth, getQdrantStore } from "../lib/chat/chat.service.js";
import { query } from "../db.js";

export const systemRouter = Router();

async function probeHttp(name, url) {
  const start = Date.now();
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return {
      name,
      status: res.ok ? "ok" : "degraded",
      latency_ms: Date.now() - start,
      http_status: res.status,
      url,
    };
  } catch (err) {
    return {
      name,
      status: "down",
      latency_ms: Date.now() - start,
      error: err.message,
      url,
    };
  }
}

systemRouter.get("/api/system/pipeline", async (_req, res) => {
  try {
    const [services, qdrantHealth, ollamaHealth, pipeline] = await Promise.all([
      Promise.all([
        probeHttp("tracking-api", `${config.pipeline.trackingApi}/health`),
        probeHttp("commerce-backend", `${config.pipeline.commerceApi}/health`),
        probeHttp("dashboard-api", "http://127.0.0.1:3000/health"),
      ]),
      getQdrantStore().health(),
      getOllamaHealth(),
      query(
        `SELECT
           (SELECT COUNT(*)::int FROM tracking_events_clean
            WHERE event_time >= NOW() - INTERVAL '5 minutes') AS events_last_5m,
           (SELECT COUNT(*)::int FROM tracking_events_clean) AS events_total,
           (SELECT MAX(event_time) FROM tracking_events_clean) AS last_event_at,
           (SELECT MAX(processed_at) FROM tracking_kpi_1m) AS last_kpi_flush,
           (SELECT COUNT(*)::int FROM tracking_kpi_1m
            WHERE window_start >= NOW() - INTERVAL '1 hour') AS kpi_windows_1h,
           (SELECT COUNT(*)::int FROM products_catalog) AS catalog_products`
      ),
    ]);

    const stats = pipeline[0] || {};
    const lastKpi = stats.last_kpi_flush ? new Date(stats.last_kpi_flush) : null;
    const lastEvent = stats.last_event_at ? new Date(stats.last_event_at) : null;
    const now = Date.now();
    const processorOk =
      (lastKpi && now - lastKpi.getTime() < 3 * 60 * 1000) ||
      (lastEvent && now - lastEvent.getTime() < 3 * 60 * 1000);

    const components = [
      ...services,
      {
        name: "streaming-processor",
        status: processorOk ? "ok" : stats.events_total > 0 ? "degraded" : "unknown",
        url: "kafka → postgres",
        detail: lastKpi
          ? `last KPI flush ${lastKpi.toISOString()}`
          : "no KPI flush yet",
      },
      {
        name: "postgres",
        status: "ok",
        url: config.db.host,
        detail: `${stats.events_total ?? 0} clean events`,
      },
      {
        name: "kafka",
        status: services[0]?.status === "ok" ? "ok" : "unknown",
        url: "tracking_events_raw",
        detail: "inferred via tracking-api",
      },
      {
        name: "rabbitmq",
        status: services[1]?.status === "ok" ? "ok" : "unknown",
        url: "commerce_events",
        detail: "inferred via commerce-backend",
      },
      {
        name: "qdrant",
        status: qdrantHealth.status === "disabled" ? "unknown" : qdrantHealth.status,
        url: qdrantHealth.url || config.qdrant.url || "—",
        detail: qdrantHealth.status === "disabled"
          ? "QDRANT_URL not set"
          : `collection ${config.qdrant.collection}`,
      },
      {
        name: "ollama",
        status: ollamaHealth.status === "disabled" ? "unknown" : ollamaHealth.status,
        url: config.ollama.url || "—",
        detail: ollamaHealth.status === "ok"
          ? `model ${config.ollama.model} · ${(ollamaHealth.models || []).join(", ")}`
          : ollamaHealth.status === "disabled"
          ? "OLLAMA_URL not set"
          : ollamaHealth.error || "unreachable",
      },
    ];

    const allOk = components.every((c) => c.status === "ok" || c.status === "unknown");

    res.json({
      status: allOk ? "healthy" : "degraded",
      checked_at: new Date().toISOString(),
      flow: [
        "Browser / Web-shop → Tracking API",
        "Tracking API → Kafka (tracking_events_raw)",
        "Streaming Processor → PostgreSQL (clean + KPI)",
        "Commerce Backend → RabbitMQ → Connector → Tracking API",
        "Streaming Processor → Qdrant (insights)",
        "Dashboard API → PostgreSQL + Qdrant → Dashboard / Chatbot",
      ],
      services: components,
      metrics: {
        events_last_5m: stats.events_last_5m ?? 0,
        events_total: stats.events_total ?? 0,
        last_event_at: stats.last_event_at,
        last_kpi_flush: stats.last_kpi_flush,
        kpi_windows_1h: stats.kpi_windows_1h ?? 0,
        catalog_products: stats.catalog_products ?? 0,
      },
    });
  } catch (err) {
    console.error("GET /api/system/pipeline", err.message);
    res.status(500).json({ error: "system_check_failed" });
  }
});
