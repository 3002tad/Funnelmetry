import { randomUUID } from "node:crypto";
import { publish } from "./publisher.js";

function eventId() {
  return `cevt_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

function baseEvent(type, body) {
  return {
    event_id: eventId(),
    event_source: "commerce_backend_rabbitmq",
    event_category: "commerce",
    event_type: type,
    anonymous_id: body.anonymous_id,
    session_id: body.session_id,
    user_id: body.user_id || null,
    page_url: body.page_url || null,
    product_id: body.product_id || null,
    timestamp: new Date().toISOString(),
    metadata: body.metadata || {},
  };
}

export const emitAddToCart = (b) => publish(baseEvent("add_to_cart", b));
export const emitCheckoutStart = (b) => publish(baseEvent("checkout_start", b));
export const emitPaymentFailed = (b) => publish(baseEvent("payment_failed", b));
export const emitCartAbandoned = (b) => publish(baseEvent("cart_abandoned", b));
export async function emitPurchaseSucceeded(b) {
  return publish(baseEvent("purchase_succeeded", {
    ...b,
    metadata: {
      order_id: b.order_id || `ORD${Date.now()}`,
      amount: b.amount || 0,
      quantity: b.quantity || 1,
      ...b.metadata,
    },
  }));
}
