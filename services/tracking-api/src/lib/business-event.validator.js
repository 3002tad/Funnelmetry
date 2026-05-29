const BUSINESS_TYPES = new Set([
  "order.created",
  "order.completed",
  "order.cancelled",
  "order.processing",
  "payment.succeeded",
  "payment.failed",
  "payment.started",
  "inventory.reserved",
  "inventory.reserve_failed",
]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

export function validateBusinessEvent(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["event must be an object"] };
  }

  const event = { ...raw };

  if (!isNonEmptyString(event.event_id)) errors.push("event_id is required");
  if (!isNonEmptyString(event.event_type)) errors.push("event_type is required");
  else if (!BUSINESS_TYPES.has(event.event_type)) {
    errors.push(`unsupported event_type: ${event.event_type}`);
  }
  if (!isNonEmptyString(event.event_source)) errors.push("event_source is required");
  if (!isNonEmptyString(event.occurred_at)) errors.push("occurred_at is required");
  if (!isNonEmptyString(event.session_id)) errors.push("session_id is required");

  const needsOrder = event.event_type?.startsWith("order.") || event.event_type?.startsWith("payment.");
  if (needsOrder && !isNonEmptyString(event.order_id)) {
    errors.push("order_id is required for order/payment events");
  }

  if (event.metadata != null && (typeof event.metadata !== "object" || Array.isArray(event.metadata))) {
    errors.push("metadata must be an object");
  }

  if (errors.length) return { ok: false, errors };
  if (event.metadata == null) event.metadata = {};
  return { ok: true, event };
}

export function validateBusinessBatch(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, errors: ["body must be a JSON object"] };
  }
  if (!Array.isArray(body.events) || body.events.length === 0) {
    return { ok: false, errors: ["events must be a non-empty array"] };
  }
  if (body.events.length > 100) {
    return { ok: false, errors: ["max 100 events per batch"] };
  }

  const events = [];
  const rejected = [];
  body.events.forEach((item, index) => {
    const result = validateBusinessEvent(item);
    if (!result.ok) {
      rejected.push({ index, event_id: item?.event_id, errors: result.errors });
    } else {
      const ev = result.event;
      if (body.tenant_id && !ev.tenant_id) ev.tenant_id = body.tenant_id;
      if (body.source && !ev.ingest_source) ev.ingest_source = body.source;
      events.push(ev);
    }
  });

  if (events.length === 0) {
    return { ok: false, errors: rejected };
  }
  return { ok: true, events, rejected, tenant_id: body.tenant_id, source: body.source };
}
