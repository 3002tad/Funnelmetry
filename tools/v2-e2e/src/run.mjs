import { createHmac, randomUUID } from "node:crypto"
import pg from "pg"

function required(name) {
  const value = process.env[name]?.trim()
  if (!value) throw new Error(`${name} is required`)
  return value
}

const gatewayUrl = required("INPUT_GATEWAY_URL").replace(/\/$/, "")
const databaseUrl = required("DATABASE_URL")
const sourceId = required("E2E_SOURCE_ID")
const browserKeyId = required("E2E_BROWSER_KEY_ID")
const browserSecret = required("E2E_BROWSER_SECRET")
const backendKeyId = required("E2E_BACKEND_KEY_ID")
const backendSecret = required("E2E_BACKEND_SECRET")
const runId = randomUUID()
const correlationId = `e2e-correlation-${runId}`
const sessionId = `e2e-session-${runId}`
const sourceEventIds = []

function ingressEvent({ suffix, eventType, producer, occurredAt, aggregate, sourcePayload }) {
  const eventId = `e2e:${runId}:${suffix}`
  sourceEventIds.push(eventId)
  return {
    specversion: "ingress-event.v1",
    source_id: sourceId,
    event_id: eventId,
    source_event_type: eventType,
    source_schema_version: "1.0",
    occurred_at: occurredAt,
    produced_at: occurredAt,
    producer,
    anonymous_id: `e2e-anonymous-${runId}`,
    session_id: sessionId,
    correlation_id: correlationId,
    ...(aggregate ? { aggregate } : {}),
    source_payload: sourcePayload,
  }
}

async function post(event) {
  const body = JSON.stringify(event)
  const headers = { "content-type": "application/json" }
  if (event.producer === "browser_sdk") {
    headers["x-funnelmetry-source-key-id"] = browserKeyId
    headers["x-funnelmetry-write-key"] = browserSecret
  } else {
    const timestamp = new Date().toISOString()
    headers["x-funnelmetry-source-key-id"] = backendKeyId
    headers["x-funnelmetry-timestamp"] = timestamp
    headers["x-funnelmetry-request-id"] = `e2e-request-${randomUUID()}`
    headers["x-funnelmetry-signature"] = createHmac("sha256", backendSecret)
      .update(`${timestamp}.${body}`)
      .digest("hex")
  }
  const response = await fetch(`${gatewayUrl}/v1/ingress/events`, { method: "POST", headers, body })
  const result = await response.json()
  if (!response.ok) throw new Error(`ingress ${event.event_id} failed (${response.status}): ${JSON.stringify(result)}`)
  return result
}

async function waitForProjection(pool, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await pool.query(
      `SELECT fact.outcome_status, fact.reached_step_count, fact.total_step_count,
              instance.journey_id, fact.funnel_instance_id
         FROM funnel_kpi_instance_facts fact
         JOIN funnel_instances instance USING (funnel_instance_id)
         JOIN canonical_events entry ON entry.canonical_event_id = instance.entry_event_id
        WHERE fact.source_id = $1 AND entry.source_event_id = $2
        ORDER BY fact.projected_at DESC
        LIMIT 1`,
      [sourceId, sourceEventIds[0]],
    )
    const projection = result.rows[0]
    if (projection?.outcome_status === "CONVERTED" && Number(projection.reached_step_count) === 4) {
      return projection
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error("timed out waiting for the converted KPI projection")
}

const baseTime = Date.now() - 10_000
const events = [
  ingressEvent({
    suffix: "view",
    eventType: "behavior.product_viewed",
    producer: "browser_sdk",
    occurredAt: new Date(baseTime).toISOString(),
    sourcePayload: { product_id: `product-${runId}` },
  }),
  ingressEvent({
    suffix: "cart",
    eventType: "cart.item_added",
    producer: "source_bridge",
    occurredAt: new Date(baseTime + 1_000).toISOString(),
    aggregate: { type: "cart", id: `cart-${runId}`, version: "1" },
    sourcePayload: { product_id: `product-${runId}`, quantity: 1 },
  }),
  ingressEvent({
    suffix: "checkout",
    eventType: "checkout.started",
    producer: "browser_sdk",
    occurredAt: new Date(baseTime + 2_000).toISOString(),
    aggregate: { type: "checkout", id: `checkout-${runId}`, version: "1" },
    sourcePayload: { cart_id: `cart-${runId}` },
  }),
  ingressEvent({
    suffix: "order",
    eventType: "order.accepted",
    producer: "source_bridge",
    occurredAt: new Date(baseTime + 3_000).toISOString(),
    aggregate: { type: "order", id: `order-${runId}`, version: "1" },
    sourcePayload: { order_id: `order-${runId}` },
  }),
]

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 })
try {
  for (const event of events) {
    const receipt = await post(event)
    if (receipt.status !== "accepted") throw new Error(`expected accepted receipt for ${event.event_id}`)
  }
  const duplicate = await post(events[0])
  if (duplicate.status !== "duplicate") throw new Error("gateway did not return a duplicate receipt")

  const projection = await waitForProjection(pool)
  const canonical = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM canonical_events
      WHERE source_id = $1 AND source_event_id = ANY($2::text[])`,
    [sourceId, sourceEventIds],
  )
  const journeys = await pool.query(
    `SELECT COUNT(DISTINCT journey_event.journey_id)::int AS count
       FROM journey_events journey_event
       JOIN canonical_events event USING (canonical_event_id)
      WHERE event.source_id = $1 AND event.source_event_id = ANY($2::text[])`,
    [sourceId, sourceEventIds],
  )

  if (canonical.rows[0].count !== 4) throw new Error(`expected 4 canonical events, got ${canonical.rows[0].count}`)
  if (journeys.rows[0].count !== 1) throw new Error(`expected 1 linked journey, got ${journeys.rows[0].count}`)

  console.log(`[v2-e2e] PASS run=${runId}`)
  console.log(`[v2-e2e] canonical=4 journeys=1 outcome=${projection.outcome_status} steps=${projection.reached_step_count}/${projection.total_step_count}`)
} finally {
  await pool.end()
}
