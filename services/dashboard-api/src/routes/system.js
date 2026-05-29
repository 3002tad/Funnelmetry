import { Router } from "express";
import { config } from "../config.js";
import { getOllamaHealth, getQdrantStore, listRecentInsights } from "../lib/chat/chat.service.js";
import { query } from "../db.js";

export const systemRouter = Router();

async function probeHttp(name, url, options = {}) {
  const start = Date.now();
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(4000),
      ...options,
    });
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

async function probeRabbitMq() {
  const base = config.pipeline.rabbitmqMgmt;
  if (!base) {
    return {
      name: "rabbitmq",
      status: "unknown",
      url: "—",
      detail: "PIPELINE_RABBITMQ_MGMT_URL not set",
    };
  }
  const url = `${base.replace(/\/$/, "")}/api/overview`;
  const auth = Buffer.from(
    `${config.pipeline.rabbitmqUser}:${config.pipeline.rabbitmqPass}`
  ).toString("base64");
  const result = await probeHttp("rabbitmq", url, {
    headers: { Authorization: `Basic ${auth}` },
  });
  return {
    ...result,
    detail: result.status === "ok" ? "management API reachable" : result.error || "unreachable",
  };
}

systemRouter.get("/api/system/pipeline", async (_req, res) => {
  try {
    const commerceHealthUrl = `${config.pipeline.commerceBackend.replace(/\/$/, "")}/health`;

    const [services, qdrantHealth, ollamaHealth, pipeline, ingestTrend, commerceStats] =
      await Promise.all([
        Promise.all([
          probeHttp("tracking-api", `${config.pipeline.trackingApi}/health`),
          probeHttp("dashboard-api", "http://127.0.0.1:3000/health"),
          probeHttp("commerce-backend", commerceHealthUrl),
        ]),
        getQdrantStore().health(),
        getOllamaHealth(),
        query(
          `SELECT
             (SELECT COUNT(*)::int FROM tracking_events_clean
              WHERE event_time >= NOW() - INTERVAL '5 minutes') AS events_last_5m,
             (SELECT COUNT(*)::int FROM tracking_events_clean
              WHERE event_time >= NOW() - INTERVAL '5 minutes'
                AND event_category = 'commerce') AS commerce_events_5m,
             (SELECT COUNT(*)::int FROM tracking_events_clean) AS events_total,
             (SELECT MAX(event_time) FROM tracking_events_clean) AS last_event_at,
             (SELECT MAX(processed_at) FROM tracking_kpi_1m) AS last_kpi_flush,
             (SELECT COUNT(*)::int FROM tracking_kpi_1m
              WHERE window_start >= NOW() - INTERVAL '1 hour') AS kpi_windows_1h,
             (SELECT COUNT(*)::int FROM products_catalog) AS catalog_products`
        ),
        query(
          `SELECT
             date_trunc('minute', event_time) AS bucket,
             COUNT(*)::int AS events
           FROM tracking_events_clean
           WHERE event_time >= NOW() - INTERVAL '60 minutes'
           GROUP BY 1
           ORDER BY 1 ASC`
        ),
        query(
          `SELECT COUNT(*)::int AS commerce_total
           FROM tracking_events_clean
           WHERE event_category = 'commerce'
             AND event_time >= NOW() - INTERVAL '24 hours'`
        ),
      ]);

    const rabbitProbe = await probeRabbitMq();

    const stats = pipeline[0] || {};
    const lastKpi = stats.last_kpi_flush ? new Date(stats.last_kpi_flush) : null;
    const lastEvent = stats.last_event_at ? new Date(stats.last_event_at) : null;
    const now = Date.now();
    const processorOk =
      (lastKpi && now - lastKpi.getTime() < 3 * 60 * 1000) ||
      (lastEvent && now - lastEvent.getTime() < 3 * 60 * 1000);

    const commerceEvents5m = stats.commerce_events_5m ?? 0;
    const ingestOk =
      services[0]?.status === "ok" &&
      (commerceEvents5m > 0 || stats.events_last_5m === 0);

    const lag = {
      seconds_since_event: lastEvent
        ? Math.floor((now - lastEvent.getTime()) / 1000)
        : null,
      seconds_since_kpi: lastKpi
        ? Math.floor((now - lastKpi.getTime()) / 1000)
        : null,
      event_stale: lastEvent ? now - lastEvent.getTime() > 5 * 60 * 1000 : true,
      kpi_stale: lastKpi ? now - lastKpi.getTime() > 5 * 60 * 1000 : true,
    };

    const behaviorServices = [
      ...services.slice(0, 2),
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
    ];

    const commerceServices = [
      services[2],
      rabbitProbe,
      {
        name: "tracking-api-ingest",
        status: ingestOk ? "ok" : stats.events_total > 0 ? "degraded" : "unknown",
        url: "POST /api/ingest/business-events (Lap2 adapter)",
        detail:
          commerceEvents5m > 0
            ? `${commerceEvents5m} commerce events / 5m`
            : "no commerce events in last 5m",
      },
    ];

    const aiServices = [
      {
        name: "qdrant",
        status: qdrantHealth.status === "disabled" ? "unknown" : qdrantHealth.status,
        url: qdrantHealth.url || config.qdrant.url || "—",
        detail:
          qdrantHealth.status === "disabled"
            ? "QDRANT_URL not set"
            : `collection ${config.qdrant.collection}`,
      },
      {
        name: "ollama",
        status: ollamaHealth.status === "disabled" ? "unknown" : ollamaHealth.status,
        url: ollamaHealth.url || config.ollama.url || "—",
        detail:
          ollamaHealth.status === "ok"
            ? `model ${config.ollama.model} · ${(ollamaHealth.models || []).join(", ")}`
            : ollamaHealth.status === "disabled"
              ? "OLLAMA_URL not set"
              : ollamaHealth.error || "unreachable",
      },
    ];

    const allComponents = [...behaviorServices, ...commerceServices, ...aiServices];
    const allOk = allComponents.every((c) => c.status === "ok" || c.status === "unknown");

    res.json({
      status: allOk ? "healthy" : "degraded",
      environment: process.env.KUBERNETES_SERVICE_HOST ? "k3s" : "local",
      checked_at: new Date().toISOString(),
      flow: {
        behavior: [
          "Browser / Web-shop SDK → Tracking API",
          "Tracking API → Kafka (tracking_events_raw)",
          "Streaming Processor → PostgreSQL (clean + KPI)",
          "Dashboard API → PostgreSQL → Manager UI",
        ],
        commerce: [
          "Web-shop commerce events → Commerce Backend",
          "Commerce Backend → RabbitMQ (commerce_events)",
          "Commerce Connector → Tracking API POST /track",
          "Streaming Processor → PostgreSQL (unified schema)",
        ],
        ai: [
          "Streaming Processor → Qdrant (pipeline_insights)",
          "Dashboard API + Ollama → Chatbot RAG",
        ],
      },
      service_groups: {
        behavior: behaviorServices,
        commerce: commerceServices,
        ai: aiServices,
      },
      services: allComponents,
      metrics: {
        events_last_5m: stats.events_last_5m ?? 0,
        commerce_events_5m: commerceEvents5m,
        commerce_events_24h: commerceStats[0]?.commerce_total ?? 0,
        events_total: stats.events_total ?? 0,
        last_event_at: stats.last_event_at,
        last_kpi_flush: stats.last_kpi_flush,
        kpi_windows_1h: stats.kpi_windows_1h ?? 0,
        catalog_products: stats.catalog_products ?? 0,
      },
      lag,
      ingest_trend: ingestTrend.map((row) => ({
        time: new Date(row.bucket).toISOString(),
        events: row.events,
      })),
    });
  } catch (err) {
    console.error("GET /api/system/pipeline", err.message);
    res.status(500).json({ error: "system_check_failed" });
  }
});

systemRouter.get("/api/system/setup", async (_req, res) => {
  const wsl = config.pipeline.demoWslIp || "<WSL_IP>";
  const host = wsl === "<WSL_IP>" ? "172.29.248.123" : wsl;

  res.json({
    wsl_ip_hint: wsl,
    ports: [
      { service: "tracking-api", nodePort: 31000, internal: "tracking-api:3000", use: "SDK POST /track" },
      { service: "commerce-backend", nodePort: 30330, internal: "commerce-backend:3000", use: "Web-shop commerce events" },
      { service: "dashboard-api", nodePort: 32000, internal: "dashboard-api:3000", use: "Vite proxy /api (dev)" },
      { service: "dashboard-ui", nodePort: 30809, internal: "dashboard-ui:80", use: "Production UI" },
    ],
    cluster_only: [
      { service: "kafka", port: 9092 },
      { service: "postgres", port: 5432 },
      { service: "rabbitmq", port: "5672 / 15672" },
      { service: "qdrant", port: 6333 },
      { service: "ollama", port: 11434 },
    ],
    env_examples: {
      web_shop: {
        TRACKING_FORWARD_URL: `http://${host}:31000/track`,
        COMMERCE_BACKEND_URL: `http://${host}:30330`,
      },
      dashboard_dev: {
        VITE_DASHBOARD_API_URL: `http://${host}:32000`,
        VITE_TRACKING_API_URL: `http://${host}:31000`,
      },
    },
    deploy: "k3s kubectl apply -k infra/k8s/sprint3",
    docs: ["infra/PORTS.md", "docs/RUNTIME.md", "docs/README.md"],
    k8s_dashboard: {
      title: "Headlamp (Kubernetes UI)",
      description:
        "Kubernetes web UI thuộc SIG UI, thay cho Kubernetes Dashboard cũ.",
      quick_open: "bash infra/k8s/ops/kubernetes-dashboard/open-headlamp.sh",
      install: "bash infra/k8s/ops/kubernetes-dashboard/install.sh",
      token: "bash infra/k8s/ops/kubernetes-dashboard/create-admin-token.sh",
      access:
        "bash infra/k8s/ops/kubernetes-dashboard/port-forward.sh → http://localhost:8443",
      docs_url:
        "https://headlamp.dev/docs/latest/installation/in-cluster/",
      readme: "infra/k8s/ops/kubernetes-dashboard/README.md",
    },
  });
});

systemRouter.get("/api/chat/insights", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 12, 30);
  try {
    const result = await listRecentInsights(limit);
    res.json(result);
  } catch (err) {
    console.error("GET /api/chat/insights", err.message);
    res.status(500).json({ error: "insights_failed" });
  }
});
