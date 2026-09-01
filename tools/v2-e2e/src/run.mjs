import { createHmac, randomUUID } from "node:crypto"
import { Kafka, logLevel } from "kafkajs"
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
const kafkaBrokers = required("KAFKA_BOOTSTRAP_SERVERS").split(",").map((value) => value.trim()).filter(Boolean)
const outcomeTopic = required("KAFKA_TOPIC_CANONICALIZATION_OUTCOMES")
const quarantineTopic = required("KAFKA_TOPIC_QUARANTINE")

function scenario(label) {
  const runId = randomUUID()
  return {
    label,
    runId,
    correlationId: `e2e-correlation-${runId}`,
    sessionId: `e2e-session-${runId}`,
    sourceEventIds: [],
  }
}

function ingressEvent(context, { suffix, eventType, producer, occurredAt, aggregate, sourcePayload }) {
  const eventId = `e2e:${context.runId}:${suffix}`
  context.sourceEventIds.push(eventId)
  return {
    specversion: "ingress-event.v1",
    source_id: sourceId,
    event_id: eventId,
    source_event_type: eventType,
    source_schema_version: "1.0",
    ...(occurredAt ? { occurred_at: occurredAt, produced_at: occurredAt } : {}),
    producer,
    anonymous_id: `e2e-anonymous-${context.runId}`,
    session_id: context.sessionId,
    correlation_id: context.correlationId,
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

async function verifyUnsupportedMapping(pool, event, timeoutMs = 60_000) {
  const kafka = new Kafka({ brokers: kafkaBrokers, clientId: `funnelmetry-v2-e2e-${randomUUID()}`, logLevel: logLevel.NOTHING })
  const consumer = kafka.consumer({ groupId: `funnelmetry-v2-e2e-unsupported-${randomUUID()}`, readUncommitted: false })
  let timeout
  try {
    await consumer.connect()
    await consumer.subscribe({ topics: [outcomeTopic, quarantineTopic], fromBeginning: true })
    const records = new Map()
    let resolveRecords
    let rejectRecords
    const recordsReady = new Promise((resolve, reject) => {
      resolveRecords = resolve
      rejectRecords = reject
    })
    timeout = setTimeout(() => rejectRecords(new Error("timed out waiting for unsupported outcome and quarantine")), timeoutMs)
    timeout.unref()

    await consumer.run({
      eachMessage: async ({ topic, message }) => {
        let key
        try {
          key = JSON.parse(message.key?.toString("utf8") ?? "null")
        } catch {
          return
        }
        if (!Array.isArray(key) || key[0] !== sourceId || key[1] !== event.event_id || message.value === null) return
        records.set(topic, JSON.parse(message.value.toString("utf8")))
        if (records.has(outcomeTopic) && records.has(quarantineTopic)) resolveRecords(records)
      },
    })

    const receipt = await post(event)
    if (receipt.status !== "accepted") throw new Error("unsupported semantic was not durably accepted as raw input")
    const terminal = await recordsReady
    const outcome = terminal.get(outcomeTopic)
    const quarantine = terminal.get(quarantineTopic)
    if (outcome.status !== "unsupported" || outcome.reason_code !== "mapping_not_found") {
      throw new Error(`unexpected canonicalization outcome: ${JSON.stringify(outcome)}`)
    }
    if (quarantine.reason_code !== "mapping_not_found" || !quarantine.source_reference?.raw_record_id) {
      throw new Error(`unexpected quarantine record: ${JSON.stringify(quarantine)}`)
    }
    const canonical = await pool.query(
      `SELECT COUNT(*)::int AS count FROM canonical_events WHERE source_id = $1 AND source_event_id = $2`,
      [sourceId, event.event_id],
    )
    if (canonical.rows[0].count !== 0) throw new Error("unsupported event unexpectedly created a canonical row")
    console.log("[v2-e2e] unsupported outcome=unsupported quarantine=mapping_not_found canonical=0")
  } finally {
    clearTimeout(timeout)
    await consumer.stop().catch(() => {})
    await consumer.disconnect().catch(() => {})
  }
}

async function waitForProjection(pool, entrySourceEventId, timeoutMs = 90_000) {
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
      [sourceId, entrySourceEventId],
    )
    const projection = result.rows[0]
    if (projection?.outcome_status === "CONVERTED" && Number(projection.reached_step_count) === 4) {
      return projection
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error("timed out waiting for the converted KPI projection")
}

async function waitForCanonicalQuality(pool, sourceEventId, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await pool.query(
      `SELECT quality->>'time_basis' AS time_basis,
              (quality->>'authoritative_event_time')::boolean AS authoritative_event_time
         FROM canonical_events
        WHERE source_id = $1 AND source_event_id = $2`,
      [sourceId, sourceEventId],
    )
    if (result.rows[0]) return result.rows[0]
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error("timed out waiting for canonical time quality")
}

async function waitForTelemetry(pool, sourceEventIds, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int
            FROM ingress_accepted_receipts
           WHERE source_id = $1 AND event_id = ANY($2::text[])) AS accepted,
         COUNT(*)::int AS terminal,
         COUNT(*) FILTER (WHERE status = 'normalized')::int AS normalized,
         COUNT(*) FILTER (WHERE status = 'unsupported')::int AS unsupported,
         COUNT(*) FILTER (WHERE status = 'quarantined')::int AS quarantined
       FROM canonicalization_latest_outcomes
      WHERE source_id = $1 AND source_event_id = ANY($2::text[])`,
      [sourceId, sourceEventIds],
    )
    const telemetry = result.rows[0]
    if (telemetry.accepted === sourceEventIds.length && telemetry.terminal === sourceEventIds.length) return telemetry
    await new Promise((resolve) => setTimeout(resolve, 1_000))
  }
  throw new Error("timed out waiting for durable ingress telemetry")
}

function commerceEvents(context, baseTime) {
  return [
    ingressEvent(context, {
      suffix: "view",
      eventType: "behavior.product_viewed",
      producer: "browser_sdk",
      occurredAt: new Date(baseTime).toISOString(),
      sourcePayload: { product_id: `product-${context.runId}` },
    }),
    ingressEvent(context, {
      suffix: "cart",
      eventType: "cart.item_added",
      producer: "source_bridge",
      occurredAt: new Date(baseTime + 1_000).toISOString(),
      aggregate: { type: "cart", id: `cart-${context.runId}`, version: "1" },
      sourcePayload: { product_id: `product-${context.runId}`, quantity: 1 },
    }),
    ingressEvent(context, {
      suffix: "checkout",
      eventType: "checkout.started",
      producer: "browser_sdk",
      occurredAt: new Date(baseTime + 2_000).toISOString(),
      aggregate: { type: "checkout", id: `checkout-${context.runId}`, version: "1" },
      sourcePayload: { cart_id: `cart-${context.runId}` },
    }),
    ingressEvent(context, {
      suffix: "order",
      eventType: "order.accepted",
      producer: "source_bridge",
      occurredAt: new Date(baseTime + 3_000).toISOString(),
      aggregate: { type: "order", id: `order-${context.runId}`, version: "1" },
      sourcePayload: { order_id: `order-${context.runId}` },
    }),
  ]
}

async function verifyCommerceScenario(pool, context, deliveryOrder) {
  for (const event of deliveryOrder) {
    const receipt = await post(event)
    if (receipt.status !== "accepted") throw new Error(`expected accepted receipt for ${event.event_id}`)
  }
  const duplicate = await post(deliveryOrder[0])
  if (duplicate.status !== "duplicate") throw new Error("gateway did not return a duplicate receipt")

  const projection = await waitForProjection(pool, context.sourceEventIds[0])
  const canonical = await pool.query(
    `SELECT COUNT(*)::int AS count
       FROM canonical_events
      WHERE source_id = $1 AND source_event_id = ANY($2::text[])`,
    [sourceId, context.sourceEventIds],
  )
  const journeys = await pool.query(
    `SELECT COUNT(DISTINCT journey_event.journey_id)::int AS count
       FROM journey_events journey_event
       JOIN canonical_events event USING (canonical_event_id)
      WHERE event.source_id = $1 AND event.source_event_id = ANY($2::text[])`,
    [sourceId, context.sourceEventIds],
  )

  if (canonical.rows[0].count !== 4) throw new Error(`expected 4 canonical events, got ${canonical.rows[0].count}`)
  if (journeys.rows[0].count !== 1) throw new Error(`expected 1 linked journey, got ${journeys.rows[0].count}`)
  console.log(`[v2-e2e] ${context.label} canonical=4 journeys=1 outcome=${projection.outcome_status} steps=${projection.reached_step_count}/${projection.total_step_count}`)
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 })
try {
  const ordered = scenario("ordered")
  const orderedEvents = commerceEvents(ordered, Date.now() - 20_000)
  await verifyCommerceScenario(pool, ordered, orderedEvents)

  const outOfOrder = scenario("out-of-order")
  const outOfOrderEvents = commerceEvents(outOfOrder, Date.now() - 10_000)
  await verifyCommerceScenario(pool, outOfOrder, [...outOfOrderEvents].reverse())

  const unsupported = scenario("unsupported")
  const unsupportedEvent = ingressEvent(unsupported, {
    suffix: "unknown",
    eventType: "catalog.product_highlighted",
    producer: "browser_sdk",
    occurredAt: new Date().toISOString(),
    sourcePayload: { product_id: `product-${unsupported.runId}` },
  })
  await verifyUnsupportedMapping(pool, unsupportedEvent)

  const fallback = scenario("fallback-time")
  const fallbackEvent = ingressEvent(fallback, {
    suffix: "view",
    eventType: "behavior.product_viewed",
    producer: "browser_sdk",
    occurredAt: null,
    sourcePayload: { product_id: `product-${fallback.runId}` },
  })
  const fallbackReceipt = await post(fallbackEvent)
  if (fallbackReceipt.status !== "accepted") throw new Error("expected accepted fallback-time receipt")
  const quality = await waitForCanonicalQuality(pool, fallbackEvent.event_id)
  if (quality.time_basis !== "ingress_fallback" || quality.authoritative_event_time !== false) {
    throw new Error(`unexpected fallback time quality: ${JSON.stringify(quality)}`)
  }

  const allSourceEventIds = [
    ...ordered.sourceEventIds,
    ...outOfOrder.sourceEventIds,
    ...unsupported.sourceEventIds,
    ...fallback.sourceEventIds,
  ]
  const telemetry = await waitForTelemetry(pool, allSourceEventIds)
  if (telemetry.normalized !== 9 || telemetry.unsupported !== 1 || telemetry.quarantined !== 0) {
    throw new Error(`unexpected durable telemetry totals: ${JSON.stringify(telemetry)}`)
  }

  console.log(`[v2-e2e] fallback-time basis=${quality.time_basis} authoritative=${quality.authoritative_event_time}`)
  console.log(`[v2-e2e] telemetry accepted=${telemetry.accepted} terminal=${telemetry.terminal} normalized=${telemetry.normalized} unsupported=${telemetry.unsupported}`)
  console.log(
    `[v2-e2e] PASS ordered=${ordered.runId} out-of-order=${outOfOrder.runId} unsupported=${unsupported.runId} fallback=${fallback.runId}`,
  )
} finally {
  await pool.end()
}
