import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { commerceRouter } from "./routes/commerce.js";
import { healthRouter } from "./routes/health.js";
import { ordersRouter } from "./routes/orders.js";

export function createApp() {
  const app = express();
  app.use(cors({ origin: config.corsOrigins, methods: ["GET", "POST", "OPTIONS"] }));
  app.use(express.json());
  app.use(healthRouter);
  app.use(ordersRouter);
  app.use(commerceRouter);
  return app;
}
