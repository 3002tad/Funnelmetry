import { Router } from "express";
import { buildBusinessEvent, orderCodeNow } from "../lib/business-events.js";
import { createOrder, getOrder, updateOrderStatus } from "../orders.store.js";
import { publishBusinessEvent } from "../publisher.js";

export const ordersRouter = Router();

/**
 * Web Demo checkout — Integration Guide §5.1–5.2.
 * Stand-in for Simulate_Demo POST /api/orders when the separate demo repo is not running.
 */
ordersRouter.post("/api/orders", async (req, res) => {
  const body = req.body || {};
  const anonymousId = body.anonymousId || body.anonymous_id;
  const sessionId = body.sessionId || body.session_id;
  const items = body.items;

  if (!anonymousId || !sessionId) {
    const fields = [];
    if (!anonymousId) fields.push("anonymousId");
    if (!sessionId) fields.push("sessionId");
    return res.status(400).json({ error: "missing_fields", fields });
  }
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "items_required" });
  }

  const orderCode = orderCodeNow();
  const normalizedItems = items.map((it) => ({
    product_id: it.productId || it.product_id,
    name: it.name || "Product",
    price: Number(it.price) || 0,
    quantity: Number(it.quantity) || 1,
    amount: (Number(it.price) || 0) * (Number(it.quantity) || 1),
  }));
  const totalAmount = normalizedItems.reduce((s, it) => s + it.amount, 0);

  const order = createOrder({
    orderCode,
    userId: body.userId || body.user_id || null,
    sessionId,
    anonymousId,
    status: "pending",
    items: normalizedItems,
    totalAmount,
    paymentMethod: body.paymentMethod || body.payment_method || "cod",
    createdAt: new Date().toISOString(),
  });

  const event = buildBusinessEvent({
    eventType: "order.created",
    eventSource: "web_demo_api",
    orderId: orderCode,
    anonymousId,
    sessionId,
    userId: order.userId,
    metadata: {
      status: "pending",
      total_amount: totalAmount,
      payment_method: order.paymentMethod,
      item_count: normalizedItems.length,
      items: normalizedItems,
    },
  });

  try {
    await publishBusinessEvent("order.created", event);
    console.log("Published event: order.created %s", orderCode);
  } catch (err) {
    console.error("rabbitmq publish failed:", err.message);
    return res.status(503).json({ error: "rabbitmq_unavailable" });
  }

  return res.status(201).json({
    orderCode,
    status: order.status,
    totalAmount,
  });
});

ordersRouter.post("/api/orders/:orderCode/cancel", async (req, res) => {
  const { orderCode } = req.params;
  const order = getOrder(orderCode);
  if (!order) {
    return res.status(404).json({ error: "order_not_found" });
  }
  if (order.status === "cancelled" || order.status === "completed") {
    return res.status(409).json({ error: "order_not_cancellable", status: order.status });
  }

  updateOrderStatus(orderCode, "cancelled");

  const event = buildBusinessEvent({
    eventType: "order.cancelled",
    eventSource: "web_demo_api",
    orderId: orderCode,
    anonymousId: order.anonymousId,
    sessionId: order.sessionId,
    userId: order.userId,
    metadata: {
      status: "cancelled",
      total_amount: order.totalAmount,
      payment_method: order.paymentMethod,
      reason: req.body?.reason || "user_cancelled",
    },
  });

  try {
    await publishBusinessEvent("order.cancelled", event);
    console.log("Published event: order.cancelled %s", orderCode);
  } catch (err) {
    console.error("rabbitmq publish failed:", err.message);
    return res.status(503).json({ error: "rabbitmq_unavailable" });
  }

  return res.status(200).json({ orderCode, status: "cancelled" });
});
