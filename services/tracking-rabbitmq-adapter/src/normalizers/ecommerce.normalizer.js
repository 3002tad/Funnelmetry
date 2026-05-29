/**
 * Raw RabbitMQ business event → canonical schema for Tracking Ingest API.
 */
export function normalizeBusinessEvent(raw) {
  if (!raw?.event_id || !raw?.event_type) {
    throw new Error("invalid business event");
  }

  return {
    event_id: raw.event_id,
    event_type: raw.event_type,
    event_source: raw.event_source,
    occurred_at: raw.occurred_at || raw.timestamp,
    anonymous_id: raw.anonymous_id ?? null,
    session_id: raw.session_id,
    user_id: raw.user_id ?? null,
    order_id: raw.order_id ?? null,
    metadata: raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {},
  };
}
