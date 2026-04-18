/**
 * E-commerce Event Generator API
 *
 * REST API generating random e-commerce events for Kafka ingestion
 * Port: 7070
 */

const express = require("express");
const cors = require("cors");
const { v4: uuidv4 } = require("uuid");

const app = express();

// ============================================================================
// EVENT QUEUE
// Events pushed here by UI (POST /gen/emit, /gen/emit-batch).
// producer-poller drains this queue via GET /gen/event before falling back
// to random generation — so Kafka is only ever written to by the poller.
// ============================================================================

// Ring buffer — O(1) push and drain instead of O(n) Array.splice
let eventBuffer = new Array(65536); // pre-allocated slots (power of 2)
let bufHead = 0;   // read pointer
let bufTail = 0;   // write pointer
let bufSize = 0;   // current count
const MAX_QUEUE_SIZE = 50000;

function bufPush(event) {
  if (bufSize >= MAX_QUEUE_SIZE) return false;
  eventBuffer[bufTail] = event;
  bufTail = (bufTail + 1) & (eventBuffer.length - 1); // bitwise wrap
  bufSize++;
  return true;
}

function bufDrain(limit) {
  const count = Math.min(limit, bufSize);
  const result = new Array(count);
  for (let i = 0; i < count; i++) {
    result[i] = eventBuffer[bufHead];
    eventBuffer[bufHead] = null; // GC-friendly
    bufHead = (bufHead + 1) & (eventBuffer.length - 1);
  }
  bufSize -= count;
  return result;
}

function bufShift() {
  if (bufSize === 0) return null;
  const event = eventBuffer[bufHead];
  eventBuffer[bufHead] = null;
  bufHead = (bufHead + 1) & (eventBuffer.length - 1);
  bufSize--;
  return event;
}

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

// ============================================================================
// PRODUCT CATALOG — realistic e-commerce products
// ============================================================================

const PRODUCTS = [
  // Electronics (high value)
  { id: "PROD-001", name: "iPhone 15 Pro Max", category: "electronics", priceRange: [25000000, 35000000] },
  { id: "PROD-002", name: "Samsung Galaxy S24", category: "electronics", priceRange: [18000000, 28000000] },
  { id: "PROD-003", name: "MacBook Air M3", category: "electronics", priceRange: [28000000, 40000000] },
  { id: "PROD-004", name: "iPad Air", category: "electronics", priceRange: [15000000, 22000000] },
  { id: "PROD-005", name: "Tai nghe Sony WH-1000XM5", category: "electronics", priceRange: [6000000, 9000000] },
  { id: "PROD-006", name: "Apple Watch Series 9", category: "electronics", priceRange: [9000000, 14000000] },
  { id: "PROD-007", name: "Loa Bluetooth JBL Flip 6", category: "electronics", priceRange: [2000000, 3500000] },
  // Fashion (medium value)
  { id: "PROD-010", name: "Áo thun Uniqlo", category: "fashion", priceRange: [200000, 500000] },
  { id: "PROD-011", name: "Quần jeans Levi's", category: "fashion", priceRange: [800000, 1800000] },
  { id: "PROD-012", name: "Giày Nike Air Max", category: "fashion", priceRange: [2500000, 4500000] },
  { id: "PROD-013", name: "Áo khoác Adidas", category: "fashion", priceRange: [1200000, 2500000] },
  { id: "PROD-014", name: "Túi xách nữ Charles & Keith", category: "fashion", priceRange: [1000000, 2000000] },
  // Food & Beverage (low value)
  { id: "PROD-020", name: "Combo gà rán KFC", category: "food", priceRange: [80000, 200000] },
  { id: "PROD-021", name: "Trà sữa Phúc Long", category: "food", priceRange: [40000, 80000] },
  { id: "PROD-022", name: "Pizza Hut size L", category: "food", priceRange: [150000, 350000] },
  { id: "PROD-023", name: "Cà phê Highlands", category: "food", priceRange: [35000, 65000] },
  // Home & Living
  { id: "PROD-030", name: "Nồi chiên không dầu Philips", category: "home", priceRange: [2000000, 4000000] },
  { id: "PROD-031", name: "Robot hút bụi Xiaomi", category: "home", priceRange: [5000000, 10000000] },
  { id: "PROD-032", name: "Bộ chăn ga Everon", category: "home", priceRange: [800000, 2000000] },
  { id: "PROD-033", name: "Máy lọc nước Kangaroo", category: "home", priceRange: [3000000, 7000000] },
  // Beauty & Health
  { id: "PROD-040", name: "Kem chống nắng Anessa", category: "beauty", priceRange: [400000, 700000] },
  { id: "PROD-041", name: "Serum Vitamin C Klairs", category: "beauty", priceRange: [300000, 500000] },
  { id: "PROD-042", name: "Son YSL Rouge Pur Couture", category: "beauty", priceRange: [800000, 1200000] },
  // Books & Stationery (low value)
  { id: "PROD-050", name: "Sách Đắc Nhân Tâm", category: "books", priceRange: [80000, 150000] },
  { id: "PROD-051", name: "Sách Nhà Giả Kim", category: "books", priceRange: [60000, 120000] },
];

const PAYMENT_METHODS = ["credit_card", "e_wallet", "bank_transfer", "cod"];
const PAYMENT_METHOD_WEIGHTS = [30, 35, 20, 15]; // credit_card 30%, e_wallet 35%, bank_transfer 20%, COD 15%

const REGIONS = [
  { code: "HCM", name: "TP. Hồ Chí Minh", weight: 35 },
  { code: "HN",  name: "Hà Nội",           weight: 30 },
  { code: "DN",  name: "Đà Nẵng",          weight: 10 },
  { code: "CT",  name: "Cần Thơ",          weight: 5 },
  { code: "HP",  name: "Hải Phòng",        weight: 5 },
  { code: "BD",  name: "Bình Dương",       weight: 5 },
  { code: "DL",  name: "Đà Lạt",           weight: 3 },
  { code: "NT",  name: "Nha Trang",        weight: 4 },
  { code: "HUE", name: "Huế",              weight: 3 },
];

// Middleware
app.use(cors());
app.use(express.json());

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
 * Pick a random product from catalog
 */
function randomProduct() {
  return PRODUCTS[Math.floor(Math.random() * PRODUCTS.length)];
}

/**
 * Generate amount based on product price range and quantity
 */
function generateAmountFromProduct(product, quantity) {
  const [min, max] = product.priceRange;
  const unitPrice = Math.floor(Math.random() * (max - min + 1)) + min;
  return unitPrice * quantity;
}

/**
 * Weighted random payment method
 */
function randomPaymentMethod() {
  const totalWeight = PAYMENT_METHOD_WEIGHTS.reduce((a, b) => a + b, 0);
  let r = Math.random() * totalWeight;
  for (let i = 0; i < PAYMENT_METHODS.length; i++) {
    r -= PAYMENT_METHOD_WEIGHTS[i];
    if (r <= 0) return PAYMENT_METHODS[i];
  }
  return PAYMENT_METHODS[0];
}

/**
 * Weighted random region
 */
function randomRegion() {
  const totalWeight = REGIONS.reduce((sum, r) => sum + r.weight, 0);
  let r = Math.random() * totalWeight;
  for (const region of REGIONS) {
    r -= region.weight;
    if (r <= 0) return region.code;
  }
  return REGIONS[0].code;
}

/**
 * Generate a single event according to schema
 */
function generateEvent() {
  const eventType = weightedRandomEventType();
  const status = mapEventToStatus(eventType);
  const product = randomProduct();
  const quantity = Math.floor(Math.random() * 3) + 1; // 1-3 items

  // Amount based on product + quantity (for success/pending), 0 for failed
  let amount;
  if (["payment_failed", "order_cancelled"].includes(eventType)) {
    amount = 0;
  } else {
    amount = generateAmountFromProduct(product, quantity);
  }

  return {
    id: uuidv4(),
    eventTime: new Date().toISOString(),
    eventType: eventType,
    orderId: `ORD-${Date.now()}-${Math.random().toString(36).substr(2, 6).toUpperCase()}`,
    userId: `USR${Math.floor(Math.random() * 10000)}`,
    amount: amount,
    currency: "VND",
    status: status,
    productId: product.id,
    productName: product.name,
    category: product.category,
    quantity: quantity,
    paymentMethod: randomPaymentMethod(),
    region: randomRegion(),
    metadata: {
      device: DEVICES[Math.floor(Math.random() * DEVICES.length)],
      ip: generateIP(),
      sessionId: generateSessionId(),
    },
    trace: {
      t_generated: new Date().toISOString(),
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
 * Generate and return a single random e-commerce event
 */
// NOTE: This endpoint is polled by producer-poller (production path).
// It does NOT publish to Kafka — the poller handles that itself.
// Returns 204 No Content when queue is empty — poller must skip that cycle.
app.get("/gen/event", (req, res) => {
  try {
    if (bufSize === 0) {
      return res.status(204).end(); // No Content — poller skips this cycle
    }
    const event = bufShift();
    console.log(
      `[${new Date().toISOString()}] Served: ${event.eventType} | Order: ${event.orderId} | Queue remaining: ${bufSize}`,
    );
    res.json(event);
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to get event", message: error.message });
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
  });
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
 * Stage N random events into the queue.
 * producer-poller will drain them on its next polls and push to Kafka.
 */
app.post("/gen/emit-batch", (req, res) => {
  try {
    let count = parseInt(req.body.count) || DEFAULT_BATCH_COUNT;
    if (count < 1 || count > MAX_BATCH_COUNT) {
      return res
        .status(400)
        .json({ error: `count must be between 1 and ${MAX_BATCH_COUNT}` });
    }
    if (bufSize + count > MAX_QUEUE_SIZE) {
      return res
        .status(429)
        .json({ error: "Queue full", queueSize: bufSize });
    }
    const events = generateEvents(count);
    for (const e of events) bufPush(e);
    console.log(
      `[${new Date().toISOString()}] Queued ${count} events | Queue size: ${bufSize}`,
    );
    res.json({ queued: count, queueSize: bufSize, events });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /gen/emit
 *
 * Stage a single custom event into the queue.
 * producer-poller will drain it on its next poll and push to Kafka.
 */
app.post("/gen/emit", (req, res) => {
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

    // Stage event in queue — poller will pick it up and push to Kafka
    bufPush(event);
    console.log(
      `[${new Date().toISOString()}] Queued: ${event.eventType} | Queue size: ${bufSize}`,
    );
    res.json({ ...event, _queued: true, queueSize: bufSize });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /gen/drain?limit=50
 *
 * Drain up to N queued events in a single request.
 * Used by producer-poller for high-throughput batch polling.
 * Returns 204 when queue is empty.
 */
app.get("/gen/drain", (req, res) => {
  try {
    if (bufSize === 0) {
      return res.status(204).end();
    }
    const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 50));
    const events = bufDrain(limit);  // O(1) per event — no array shifting
    console.log(
      `[${new Date().toISOString()}] Drained: ${events.length} events | Queue remaining: ${bufSize}`,
    );
    res.json({ count: events.length, queueSize: bufSize, events });
  } catch (error) {
    res
      .status(500)
      .json({ error: "Failed to drain events", message: error.message });
  }
});

/**
 * GET /gen/queue
 *
 * Show current queue status.
 */
app.get("/gen/queue", (req, res) => {
  res.json({ queueSize: bufSize });
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
      "GET /gen/events?count=N": `Generate N events (default: ${CONFIG.defaultCount}, max: ${MAX_BATCH_COUNT})`,
      "GET /gen/config": "Get current API configuration",
      "POST /gen/config":
        "Update configuration (distribution, defaultCount, ratePerSec)",
      "POST /gen/emit": "Generate custom event with overrides",
      "GET /health": "Health check",
      "GET /": "API documentation (this page)",
    },
    eventTypes: Object.keys(EVENT_DISTRIBUTION),
    eventDistribution: EVENT_DISTRIBUTION,
    examples: {
      single: `http://localhost:${PORT}/gen/event`,
      batch: `http://localhost:${PORT}/gen/events?count=50`,
      config: `http://localhost:${PORT}/gen/config`,
      health: `http://localhost:${PORT}/health`,
      emit: `curl -X POST http://localhost:${PORT}/gen/emit -H "Content-Type: application/json" -d '{"eventType":"payment_success","amount":1000000}'`,
    },
  });
});

// ============================================================================
// START SERVER
// ============================================================================

app.listen(PORT, () => {
  console.log("=".repeat(70));
  console.log(`🚀 E-commerce Event Generator API`);
  console.log("=".repeat(70));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🔗 Endpoints:`);
  console.log(`   - GET http://localhost:${PORT}/gen/event`);
  console.log(`   - GET http://localhost:${PORT}/gen/events?count=50`);
  console.log(`   - GET http://localhost:${PORT}/gen/config`);
  console.log(`   - GET http://localhost:${PORT}/health`);
  console.log("=".repeat(70));
  console.log(`📊 Event Distribution:`);
  Object.entries(EVENT_DISTRIBUTION).forEach(([type, weight]) => {
    console.log(`   - ${type}: ${weight}%`);
  });
  console.log("=".repeat(70));
});

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM signal received: closing HTTP server");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("\nSIGINT signal received: closing HTTP server");
  process.exit(0);
});
