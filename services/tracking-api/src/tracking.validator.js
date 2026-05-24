const BEHAVIOR_TYPES = new Set([
  "page_view",
  "product_view",
  "product_click",
  "scroll_depth",
  "search",
  "filter_apply",
  "banner_impression",
  "banner_click",
]);

const COMMERCE_TYPES = new Set([
  "add_to_cart",
  "checkout_start",
  "purchase_succeeded",
  "payment_failed",
  "cart_abandoned",
]);

const SOURCES = new Set(["browser_sdk", "commerce_backend_rabbitmq"]);
const CATEGORIES = new Set(["behavior", "commerce"]);

function isNonEmptyString(v) {
  return typeof v === "string" && v.trim().length > 0;
}

export function validateTrackingEvent(raw) {
  const errors = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, errors: ["body must be a JSON object"] };
  }

  const event = { ...raw };

  if (event.metadata != null && (typeof event.metadata !== "object" || Array.isArray(event.metadata))) {
    errors.push("metadata must be an object");
  }

  if (event.event_source && !SOURCES.has(event.event_source)) {
    errors.push(`event_source must be one of: ${[...SOURCES].join(", ")}`);
  }
  if (event.event_category && !CATEGORIES.has(event.event_category)) {
    errors.push(`event_category must be one of: ${[...CATEGORIES].join(", ")}`);
  }

  const types = event.event_category === "commerce" ? COMMERCE_TYPES : BEHAVIOR_TYPES;
  if (event.event_type && !types.has(event.event_type) && !BEHAVIOR_TYPES.has(event.event_type) && !COMMERCE_TYPES.has(event.event_type)) {
    errors.push(`unsupported event_type: ${event.event_type}`);
  }

  if (!isNonEmptyString(event.event_type)) errors.push("event_type is required");
  if (!isNonEmptyString(event.anonymous_id)) errors.push("anonymous_id is required");
  if (!isNonEmptyString(event.session_id)) errors.push("session_id is required");

  if (event.timestamp != null && Number.isNaN(Date.parse(event.timestamp))) {
    errors.push("timestamp must be ISO 8601");
  }

  if (errors.length) return { ok: false, errors };

  return { ok: true, event };
}

export function validateBatch(body) {
  if (!body || !Array.isArray(body.events)) {
    return { ok: false, errors: ["body.events must be an array"] };
  }
  if (body.events.length === 0) {
    return { ok: false, errors: ["events must not be empty"] };
  }
  if (body.events.length > 100) {
    return { ok: false, errors: ["max 100 events per batch"] };
  }
  const events = [];
  const allErrors = [];
  body.events.forEach((item, i) => {
    const result = validateTrackingEvent(item);
    if (!result.ok) {
      allErrors.push({ index: i, errors: result.errors });
    } else {
      events.push(result.event);
    }
  });
  if (allErrors.length) return { ok: false, errors: allErrors };
  return { ok: true, events };
}
