import { randomUUID } from "node:crypto";

export function newEventId(prefix = "evt") {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function orderCodeNow() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const seq = String(Math.floor(Math.random() * 10000)).padStart(4, "0");
  return `ORDER-${y}${m}${day}-${seq}`;
}

/**
 * Integration Guide §6 — business event published to RabbitMQ.
 */
export function buildBusinessEvent({
  eventType,
  eventSource,
  orderId,
  anonymousId,
  sessionId,
  userId = null,
  metadata = {},
}) {
  return {
    event_id: newEventId(eventType.replace(/\./g, "_")),
    event_type: eventType,
    event_source: eventSource,
    occurred_at: new Date().toISOString(),
    anonymous_id: anonymousId,
    session_id: sessionId,
    user_id: userId,
    order_id: orderId,
    metadata,
  };
}
