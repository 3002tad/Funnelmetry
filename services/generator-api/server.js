/**
 * E-commerce Event Generator API
 *
 * REST API generating random e-commerce events for Kafka ingestion
 * Port: 7070
 */

const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");
const { Kafka, logLevel } = require("kafkajs");

const app = express();

// ============================================================================
// KAFKA DIRECT PRODUCER
// Primary path: generator-api publishes directly to Kafka.
// Optional legacy fallback: eventQueue[] is only used when Kafka is unavailable
// and ENABLE_QUEUE_FALLBACK=true.
// ============================================================================
const KAFKA_BOOTSTRAP_SERVERS = process.env.KAFKA_BOOTSTRAP_SERVERS || "kafka:9092";
const KAFKA_TOPIC              = process.env.KAFKA_TOPIC              || "events_raw";
const ENABLE_QUEUE_FALLBACK    = (process.env.ENABLE_QUEUE_FALLBACK || "false") === "true";

const kafka = new Kafka({
  clientId: "api-generator",
  brokers:  KAFKA_BOOTSTRAP_SERVERS.split(","),
  connectionTimeout: 3000,
  retry: { retries: 3, initialRetryTime: 300 },
  logLevel: logLevel.NOTHING, // suppress kafkajs internal logs
});

const kafkaProducer = kafka.producer({
  allowAutoTopicCreation: true,
  idempotent: false,         // single-broker demo: no need for idempotent producer
  transactionTimeout: 30000,
  timeout: 30000,
  maxInFlightRequests: 5,    // Allow parallel request batches for better throughput
  compression: 1,            // GZIP compression (1 = GZIP, 0 = None)
  retry: {
    retries: 3,
    initialRetryTime: 100,
    factor: 2,
    maxRetryTime: 30000,
    multiplier: 2,
  },
});

let kafkaReady = false;
let metrics = {
  httpRequestsTotal: 0,
  emittedTotal: 0,
  emittedToKafkaTotal: 0,
  queuedFallbackTotal: 0,
  kafkaPublishFailuresTotal: 0,
};

function renderPrometheusMetrics() {
  return [
    "# HELP api_generator_http_requests_total Total HTTP requests handled by generator-api",
    "# TYPE api_generator_http_requests_total counter",
    `api_generator_http_requests_total ${metrics.httpRequestsTotal}`,
    "# HELP api_generator_emitted_total Total events accepted by emit endpoints",
    "# TYPE api_generator_emitted_total counter",
    `api_generator_emitted_total ${metrics.emittedTotal}`,
    "# HELP api_generator_emitted_to_kafka_total Total events published directly to Kafka",
    "# TYPE api_generator_emitted_to_kafka_total counter",
    `api_generator_emitted_to_kafka_total ${metrics.emittedToKafkaTotal}`,
    "# HELP api_generator_queued_fallback_total Total events placed into fallback queue",
    "# TYPE api_generator_queued_fallback_total counter",
    `api_generator_queued_fallback_total ${metrics.queuedFallbackTotal}`,
    "# HELP api_generator_kafka_publish_failures_total Total Kafka publish failures",
    "# TYPE api_generator_kafka_publish_failures_total counter",
    `api_generator_kafka_publish_failures_total ${metrics.kafkaPublishFailuresTotal}`,
    "# HELP api_generator_kafka_ready Kafka direct producer readiness",
    "# TYPE api_generator_kafka_ready gauge",
    `api_generator_kafka_ready ${kafkaReady ? 1 : 0}`,
    "# HELP api_generator_queue_size Current fallback queue size",
    "# TYPE api_generator_queue_size gauge",
    `api_generator_queue_size ${eventQueue.length}`,
    "# HELP api_generator_queue_fallback_enabled Whether legacy queue fallback is enabled",
    "# TYPE api_generator_queue_fallback_enabled gauge",
    `api_generator_queue_fallback_enabled ${ENABLE_QUEUE_FALLBACK ? 1 : 0}`,
  ].join("\n");
}

async function connectKafka() {
  try {
    await kafkaProducer.connect();
    kafkaReady = true;
    console.log("[api-generator] ✅ Kafka producer connected — direct publish enabled");
  } catch (err) {
    kafkaReady = false;
    console.warn(
      `[api-generator] ⚠️  Kafka unavailable (${err.message})${ENABLE_QUEUE_FALLBACK ? ", legacy fallback queue enabled" : ", legacy fallback queue disabled"}`,
    );
    setTimeout(connectKafka, 10_000); // retry every 10 s
  }
}

/**
 * Publish events directly to Kafka.
 * Returns true on success, false on failure (caller falls back to queue).
 */
async function publishToKafka(events) {
  if (!kafkaReady) return false;
  try {
    const messages = events.map((e) => ({
      key:   e.orderId,          // partition by orderId for ordering guarantees
      value: JSON.stringify(e),
    }));
    await kafkaProducer.send({ topic: KAFKA_TOPIC, messages });
    return true;
  } catch (err) {
    console.error("[api-generator] Kafka send failed:", err.message);
    kafkaReady = false;
    metrics.kafkaPublishFailuresTotal += 1;
    setTimeout(connectKafka, 10_000);
    return false;
  }
}

function enqueueFallback(events) {
  if (!ENABLE_QUEUE_FALLBACK) return { ok: false, reason: "disabled" };
  if (eventQueue.length + events.length > MAX_QUEUE_SIZE) {
    return { ok: false, reason: "full" };
  }
  eventQueue.push(...events);
  metrics.queuedFallbackTotal += events.length;
  return { ok: true, reason: "queued" };
}
// ============================================================================
// LEGACY FALLBACK QUEUE
// Primary architecture: generator-api -> Kafka.
// eventQueue[] only exists for optional legacy fallback mode when Kafka is
// temporarily unavailable and ENABLE_QUEUE_FALLBACK=true.
// ============================================================================

const eventQueue = [];
const MAX_QUEUE_SIZE = 10000;

// ============================================================================
// CONFIGURATION
// ============================================================================

const PORT = process.env.PORT || 7070;
const DEFAULT_BATCH_COUNT = parseInt(process.env.DEFAULT_BATCH_COUNT) || 10;
const MAX_BATCH_COUNT = 500;

/**
 * Event type distribution (theo yêu cầu)
 * - 30% order_created
 * - 25% payment_initiated
 * - 35% payment_success
 * - 8% payment_failed
 * - 2% order_cancelled
 */
let EVENT_DISTRIBUTION = {
  order_created: 30,
  payment_initiated: 25,
  payment_success: 35,
  payment_failed: 8,
  order_cancelled: 2,
};

let CONFIG = {
  defaultCount: DEFAULT_BATCH_COUNT,
  ratePerSec: 1,
};

const DEVICES = ["mobile", "desktop", "tablet"];

// Middleware
app.use(
  cors({
    origin: ["http://localhost:5174", "http://127.0.0.1:5174"],
    methods: ["GET", "POST"],
    credentials: true,
  }),
);
app.use(express.json());
app.use((req, res, next) => {
  metrics.httpRequestsTotal += 1;
  next();
});

// ============================================================================
// EVENT GENERATION LOGIC
// ============================================================================

/**
 * Weighted random selection based on distribution
 */
function weightedRandomEventType() {
  const entries = Object.entries(EVENT_DISTRIBUTION);
  const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let random = Math.random() * totalWeight;

  for (const [type, weight] of entries) {
    random -= weight;
    if (random <= 0) {
      return type;
    }
  }
  return entries[0][0]; // fallback
}

/**
 * Generate amount based on event type
 *
 * Rules:
 * - payment_success: 50k - 5M VND (có giao dịch thành công)
 * - payment_failed: 0 VND (giao dịch thất bại không có amount)
 * - payment_initiated: 50k - 3M VND (đang chờ thanh toán)
 * - order_created: 50k - 3M VND (giá trị đơn hàng ước tính)
 * - order_cancelled: 0 VND (đã hủy không tính amount)
 */
function generateAmount(eventType) {
  switch (eventType) {
    case "payment_success":
      // Giao dịch thành công: 50k - 5M VND
      return Math.floor(Math.random() * (5000000 - 50000 + 1)) + 50000;

    case "payment_initiated":
    case "order_created":
      // Pending: 50k - 3M VND
      return Math.floor(Math.random() * (3000000 - 50000 + 1)) + 50000;

    case "payment_failed":
    case "order_cancelled":
      // Failed: 0 VND
      return 0;

    default:
      return 0;
  }
}

/**
 * Map event type to status
 *
 * Logic:
 * - order_created: pending (đơn hàng mới tạo, chờ thanh toán)
 * - payment_initiated: pending (đã bắt đầu thanh toán, chờ xác nhận)
 * - payment_success: success (thanh toán thành công)
 * - payment_failed: failed (thanh toán thất bại)
 * - order_cancelled: failed (đơn hàng đã bị hủy, coi như thất bại)
 */
function mapEventToStatus(eventType) {
  switch (eventType) {
    case "order_created":
    case "payment_initiated":
      return "pending";

    case "payment_success":
      return "success";

    case "payment_failed":
    case "order_cancelled":
      return "failed";

    default:
      return "pending";
  }
}

/**
 * Generate random IP address
 */
function generateIP() {
  return `${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}.${Math.floor(Math.random() * 256)}`;
}

/**
 * Generate random session ID
 */
function generateSessionId() {
  return `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Generate a single event according to schema
 */
function generateEvent() {
  const eventType = weightedRandomEventType();
  const amount = generateAmount(eventType);
  const status = mapEventToStatus(eventType);

  return {
    id: uuidv4(),
    eventTime: new Date().toISOString(),
    eventType: eventType,
    orderId: `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
    userId: `USR${Math.floor(Math.random() * 10000)}`,
    amount: amount,
    currency: "VND",
    status: status,
    metadata: {
      device: DEVICES[Math.floor(Math.random() * DEVICES.length)],
      ip: generateIP(),
      sessionId: generateSessionId(),
    },
  };
}

/**
 * Generate multiple events
 */
function generateEvents(count) {
  const events = [];
  for (let i = 0; i < count; i++) {
    events.push(generateEvent());
  }
  return events;
}

// ============================================================================
// API ENDPOINTS
// ============================================================================

/**
 * GET /gen/event
 *
 * Return a single queued fallback event.
 */
// Legacy endpoint for producer-poller fallback mode only.
app.get("/gen/event", (req, res) => {
  try {
    if (eventQueue.length === 0) {
      return res.status(204).end(); // No Content — poller skips this cycle
    }
    const event = eventQueue.shift();
    console.log(
      `[${new Date().toISOString()}] Served: ${event.eventType} | Order: ${event.orderId} | Queue remaining: ${eventQueue.length}`,
    );
    res.json(event);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to get event", message: error.message });
  }
});

/**
 * GET /gen/drain?limit=50
 *
 * Drain up to N queued fallback events in a single request.
 * Used only by producer-poller when legacy fallback mode is enabled.
 */
app.get("/gen/drain", (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));

    if (eventQueue.length === 0) {
      return res.status(204).end();
    }

    const drainCount = Math.min(limit, eventQueue.length);
    const events = eventQueue.splice(0, drainCount);

    res.json({
      count: events.length,
      queueSize: eventQueue.length,
      events,
    });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to drain events", message: error.message });
  }
});

/**
 * GET /gen/events?count=50
 *
 * Generate and return multiple events
 * - count: số lượng events (default: DEFAULT_BATCH_COUNT, max: 500)
 */
// Read-only preview — does not affect the queue or pipeline.
app.get("/gen/events", (req, res) => {
  try {
    let count = parseInt(req.query.count) || DEFAULT_BATCH_COUNT;
    if (count < 1 || count > MAX_BATCH_COUNT) {
      return res
        .status(400)
        .json({ error: `count must be between 1 and ${MAX_BATCH_COUNT}` });
    }
    const events = generateEvents(count);
    res.json({ count: events.length, events });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to generate events", message: error.message });
  }
});

/**
 * GET /health
 *
 * Health check endpoint
 */
app.get("/health", (req, res) => {
  res.json({
    ok: true,
    time: new Date().toISOString(),
    service: "event-generator-api",
    port: PORT,
    kafka: { connected: kafkaReady, topic: KAFKA_TOPIC },
    queue: { enabled: ENABLE_QUEUE_FALLBACK, size: eventQueue.length, maxSize: MAX_QUEUE_SIZE },
  });
});

app.get("/metrics", (req, res) => {
  res.set("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
  res.send(renderPrometheusMetrics());
});

/**
 * GET /gen/config
 *
 * Return current configuration
 */
app.get("/gen/config", (req, res) => {
  res.json({
    distribution: EVENT_DISTRIBUTION,
    defaultCount: CONFIG.defaultCount,
    ratePerSec: CONFIG.ratePerSec,
    amountRules: {
      payment_success: "50,000 - 5,000,000 VND",
      payment_initiated: "50,000 - 3,000,000 VND",
      order_created: "50,000 - 3,000,000 VND",
      payment_failed: "0 VND",
      order_cancelled: "0 VND",
    },
  });
});

/**
 * POST /gen/config
 *
 * Update configuration
 */
app.post("/gen/config", (req, res) => {
  try {
    const { distribution, defaultCount, ratePerSec } = req.body;

    // Update distribution if provided
    if (distribution) {
      const total = Object.values(distribution).reduce(
        (sum, val) => sum + val,
        0,
      );
      if (Math.abs(total - 1.0) > 0.01 && Math.abs(total - 100) > 0.01) {
        return res.status(400).json({
          error: "Distribution must sum to 1.0 or 100",
          received: total,
        });
      }

      // Convert to percentage if needed
      const normalizedDist = {};
      Object.entries(distribution).forEach(([key, val]) => {
        normalizedDist[key] = val > 1 ? val : val * 100;
      });

      EVENT_DISTRIBUTION.order_created =
        normalizedDist.order_created || EVENT_DISTRIBUTION.order_created;
      EVENT_DISTRIBUTION.payment_initiated =
        normalizedDist.payment_initiated ||
        EVENT_DISTRIBUTION.payment_initiated;
      EVENT_DISTRIBUTION.payment_success =
        normalizedDist.payment_success || EVENT_DISTRIBUTION.payment_success;
      EVENT_DISTRIBUTION.payment_failed =
        normalizedDist.payment_failed || EVENT_DISTRIBUTION.payment_failed;
      EVENT_DISTRIBUTION.order_cancelled =
        normalizedDist.order_cancelled || EVENT_DISTRIBUTION.order_cancelled;
    }

    // Update other config
    if (defaultCount !== undefined) CONFIG.defaultCount = defaultCount;
    if (ratePerSec !== undefined) CONFIG.ratePerSec = ratePerSec;

    res.json({
      message: "Configuration updated successfully",
      config: {
        distribution: EVENT_DISTRIBUTION,
        defaultCount: CONFIG.defaultCount,
        ratePerSec: CONFIG.ratePerSec,
      },
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /gen/emit-batch
 *
 * Publish N random events directly to Kafka.
 * Falls back to legacy queue only if ENABLE_QUEUE_FALLBACK=true.
 */
app.post("/gen/emit-batch", async (req, res) => {
  try {
    let count = parseInt(req.body.count) || DEFAULT_BATCH_COUNT;
    if (count < 1 || count > MAX_BATCH_COUNT) {
      return res
        .status(400)
        .json({ error: `count must be between 1 and ${MAX_BATCH_COUNT}` });
    }
    const events = generateEvents(count);
    metrics.emittedTotal += events.length;
    const sent = await publishToKafka(events);
    let path = "kafka";
    if (!sent) {
      const fallback = enqueueFallback(events);
      if (!fallback.ok) {
        return res.status(fallback.reason === "full" ? 429 : 503).json({
          error:
            fallback.reason === "full"
              ? "Fallback queue full"
              : "Kafka unavailable and fallback queue disabled",
          queueSize: eventQueue.length,
          fallbackEnabled: ENABLE_QUEUE_FALLBACK,
        });
      }
      path = "queue";
    }
    if (path === "kafka") metrics.emittedToKafkaTotal += events.length;
    console.log(
      `[${new Date().toISOString()}] Batch emitted (${path}): ${count} events | Queue: ${eventQueue.length}`,
    );
    res.json({ count, path, fallbackEnabled: ENABLE_QUEUE_FALLBACK, queueSize: eventQueue.length, events });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /gen/emit
 *
 * Publish a single custom event directly to Kafka.
 * Falls back to legacy queue only if ENABLE_QUEUE_FALLBACK=true.
 */
app.post("/gen/emit", async (req, res) => {
  try {
    const { eventType, status, amount, orderId, userId, lateMinutes } =
      req.body;

    let event = generateEvent();

    // Apply overrides
    if (eventType) {
      event.eventType = eventType;
      // Recalculate status and amount based on eventType
      event.status = mapEventToStatus(eventType);
      if (eventType === "payment_success") {
        event.amount =
          amount !== undefined ? amount : generateAmount(eventType);
      } else if (["payment_failed", "order_cancelled"].includes(eventType)) {
        event.amount = 0;
      } else {
        event.amount =
          amount !== undefined ? amount : generateAmount(eventType);
      }
    }

    if (status) event.status = status;
    if (amount !== undefined) event.amount = amount;
    if (orderId) event.orderId = orderId;
    if (userId) event.userId = userId;

    // Handle late events
    if (lateMinutes && lateMinutes > 0) {
      const eventDate = new Date(event.eventTime);
      eventDate.setMinutes(eventDate.getMinutes() - lateMinutes);
      event.eventTime = eventDate.toISOString();
    }

    metrics.emittedTotal += 1;
    const sent = await publishToKafka([event]);
    let path = "kafka";
    if (!sent) {
      const fallback = enqueueFallback([event]);
      if (!fallback.ok) {
        return res.status(fallback.reason === "full" ? 429 : 503).json({
          error:
            fallback.reason === "full"
              ? "Fallback queue full"
              : "Kafka unavailable and fallback queue disabled",
          queueSize: eventQueue.length,
          fallbackEnabled: ENABLE_QUEUE_FALLBACK,
        });
      }
      path = "queue";
    }
    if (path === "kafka") metrics.emittedToKafkaTotal += 1;
    console.log(
      `[${new Date().toISOString()}] Emitted (${path}): ${event.eventType} | Queue: ${eventQueue.length}`,
    );
    res.json({ ...event, _path: path, fallbackEnabled: ENABLE_QUEUE_FALLBACK, queueSize: eventQueue.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /gen/queue
 *
 * Show current queue status.
 */
app.get("/gen/queue", (req, res) => {
  res.json({ enabled: ENABLE_QUEUE_FALLBACK, queueSize: eventQueue.length, maxSize: MAX_QUEUE_SIZE });
});

/**
 * GET /
 *
 * API documentation
 */
app.get("/", (req, res) => {
  res.json({
    service: "E-commerce Event Generator API",
    version: "1.0.0",
    endpoints: {
      "GET /gen/event": "Generate a single random e-commerce event",
      "GET /gen/drain?limit=N": "Drain up to N legacy fallback queued events",
      "GET /gen/events?count=N": `Generate N events (default: ${CONFIG.defaultCount}, max: ${MAX_BATCH_COUNT})`,
      "GET /gen/config": "Get current API configuration",
      "POST /gen/config":
        "Update configuration (distribution, defaultCount, ratePerSec)",
      "POST /gen/emit": "Generate custom event and publish directly to Kafka",
      "POST /gen/emit-batch": "Generate N events and publish directly to Kafka",
      "GET /health": "Health check",
      "GET /metrics": "Prometheus-style metrics",
      "GET /": "API documentation (this page)",
    },
    eventTypes: Object.keys(EVENT_DISTRIBUTION),
    eventDistribution: EVENT_DISTRIBUTION,
    examples: {
      single: `http://localhost:${PORT}/gen/event`,
      drain: `http://localhost:${PORT}/gen/drain?limit=50`,
      batch: `http://localhost:${PORT}/gen/events?count=50`,
      config: `http://localhost:${PORT}/gen/config`,
      health: `http://localhost:${PORT}/health`,
      metrics: `http://localhost:${PORT}/metrics`,
      emit: `curl -X POST http://localhost:${PORT}/gen/emit -H "Content-Type: application/json" -d '{"eventType":"payment_success","amount":1000000}'`,
    },
  });
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, async () => {
  console.log("=".repeat(70));
  console.log(`🚀 E-commerce Event Generator API`);
  console.log("=".repeat(70));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🔗 Endpoints:`);
  console.log(`   - GET http://localhost:${PORT}/gen/event`);
  console.log(`   - GET http://localhost:${PORT}/gen/events?count=50`);
  console.log(`   - GET http://localhost:${PORT}/gen/config`);
  console.log(`   - GET http://localhost:${PORT}/health`);
  console.log(`   - GET http://localhost:${PORT}/metrics`);
  console.log("=".repeat(70));
  console.log(`📊 Event Distribution:`);
  Object.entries(EVENT_DISTRIBUTION).forEach(([type, weight]) => {
    console.log(`   - ${type}: ${weight}%`);
  });
  console.log(`📡 Kafka: ${KAFKA_BOOTSTRAP_SERVERS} → topic: ${KAFKA_TOPIC}`);
  console.log(`🧰 Legacy queue fallback: ${ENABLE_QUEUE_FALLBACK ? "ENABLED" : "DISABLED"}`);
  connectKafka();
  console.log("=".repeat(70));
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  kafkaProducer.disconnect().catch(() => {});
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("\nSIGINT signal received: closing HTTP server");
  kafkaProducer.disconnect().catch(() => {});
  process.exit(0);
});
