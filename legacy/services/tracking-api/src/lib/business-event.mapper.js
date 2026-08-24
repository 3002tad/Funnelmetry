/**
 * Canonical business event (Adapter) → tracking Kafka schema.
 * Revenue KPI: order.completed → purchase_succeeded (Standard §8).
 */

const KAFKA_TYPE_MAP = {
  "order.completed": "purchase_succeeded",
  "payment.failed": "payment_failed",
  "order.cancelled": "order_cancelled",
  "order.created": "checkout_start",
};

export function businessEventToTracking(canonical) {
  const businessType = canonical.event_type;
  const trackingType = KAFKA_TYPE_MAP[businessType];
  if (!trackingType) {
    return null;
  }

  const meta = { ...(canonical.metadata || {}) };
  meta.business_event_type = businessType;
  meta.business_event_source = canonical.event_source;
  if (canonical.order_id) meta.order_id = canonical.order_id;
  if (canonical.tenant_id) meta.tenant_id = canonical.tenant_id;
  // Worker sends total_amount on order.completed; streaming KPI reads amount.
  if (meta.amount == null && meta.total_amount != null) {
    meta.amount = meta.total_amount;
  }

  const items = meta.items || [];
  let product_id = canonical.product_id || null;
  if (!product_id && items[0]?.product_id) {
    product_id = items[0].product_id;
  }

  return {
    event_id: canonical.event_id,
    event_type: trackingType,
    event_source: "rabbitmq_adapter",
    event_category: "commerce",
    anonymous_id: canonical.anonymous_id,
    session_id: canonical.session_id,
    user_id: canonical.user_id ?? null,
    product_id,
    timestamp: canonical.occurred_at || canonical.timestamp,
    metadata: meta,
  };
}
