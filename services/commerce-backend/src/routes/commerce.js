import { Router } from "express";
import {
  emitAddToCart, emitCartAbandoned, emitCheckoutStart,
  emitPaymentFailed, emitPurchaseSucceeded,
} from "../commerce.service.js";

export const commerceRouter = Router();

function required(body, fields) {
  const miss = fields.filter((f) => !body[f]);
  return miss.length ? miss : null;
}

commerceRouter.post("/commerce/add-to-cart", async (req, res) => {
  const miss = required(req.body, ["anonymous_id", "session_id", "product_id"]);
  if (miss) return res.status(400).json({ error: "missing_fields", fields: miss });
  await emitAddToCart(req.body);
  res.status(202).json({ accepted: true });
});

commerceRouter.post("/commerce/checkout-start", async (req, res) => {
  const miss = required(req.body, ["anonymous_id", "session_id"]);
  if (miss) return res.status(400).json({ error: "missing_fields", fields: miss });
  await emitCheckoutStart(req.body);
  res.status(202).json({ accepted: true });
});

commerceRouter.post("/commerce/purchase", async (req, res) => {
  const miss = required(req.body, ["anonymous_id", "session_id"]);
  if (miss) return res.status(400).json({ error: "missing_fields", fields: miss });
  await emitPurchaseSucceeded(req.body);
  res.status(202).json({ accepted: true });
});

commerceRouter.post("/commerce/payment-failed", async (req, res) => {
  const miss = required(req.body, ["anonymous_id", "session_id"]);
  if (miss) return res.status(400).json({ error: "missing_fields", fields: miss });
  await emitPaymentFailed(req.body);
  res.status(202).json({ accepted: true });
});

commerceRouter.post("/commerce/cart-abandoned", async (req, res) => {
  const miss = required(req.body, ["anonymous_id", "session_id"]);
  if (miss) return res.status(400).json({ error: "missing_fields", fields: miss });
  await emitCartAbandoned(req.body);
  res.status(202).json({ accepted: true });
});
