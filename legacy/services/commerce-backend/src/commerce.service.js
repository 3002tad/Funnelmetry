import { buildBusinessEvent } from "./lib/business-events.js";
import { publishBusinessEvent } from "./publisher.js";

/** Legacy HTTP helpers — publish Integration Guide routing keys. */
export const emitAddToCart = (b) =>
  publishLegacy("cart.item_added", "add_to_cart", b);

export const emitCheckoutStart = (b) =>
  publishLegacy("order.checkout_started", "checkout_start", b);

export const emitPaymentFailed = (b) =>
  publishLegacy("payment.failed", "payment_failed", b);

export const emitCartAbandoned = (b) =>
  publishLegacy("cart.abandoned", "cart_abandoned", b);

export async function emitPurchaseSucceeded(b) {
  const orderId = b.order_id || b.orderId || `ORD${Date.now()}`;
  const event = buildBusinessEvent({
    eventType: "order.completed",
    eventSource: "web_demo_backend",
    orderId,
    anonymousId: b.anonymous_id,
    sessionId: b.session_id,
    userId: b.user_id || null,
    metadata: {
      status: "completed",
      total_amount: b.amount || 0,
      payment_method: b.payment_method || "cod",
      item_count: 1,
      items: b.product_id
        ? [{
            product_id: b.product_id,
            quantity: b.quantity || 1,
            amount: b.amount || 0,
          }]
        : [],
      ...b.metadata,
    },
  });
  return publishBusinessEvent("order.completed", event);
}

async function publishLegacy(routingKey, _legacyType, body) {
  const event = buildBusinessEvent({
    eventType: routingKey.replace(/\./g, "_"),
    eventSource: "web_demo_backend",
    orderId: body.order_id || body.orderId || `TMP-${Date.now()}`,
    anonymousId: body.anonymous_id,
    sessionId: body.session_id,
    userId: body.user_id || null,
    metadata: body.metadata || { product_id: body.product_id },
  });
  event.event_type = routingKey;
  return publishBusinessEvent(routingKey, event);
}
