import cors from "cors";
import express from "express";
import { config } from "./config.js";
import { requireAuth } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { bannersRouter } from "./routes/banners.js";
import { eventsRouter } from "./routes/events.js";
import { funnelRouter } from "./routes/funnel.js";
import { healthRouter } from "./routes/health.js";
import { overviewRouter } from "./routes/overview.js";
import { productsRouter } from "./routes/products.js";
import { revenueRouter } from "./routes/revenue.js";
import { searchRouter } from "./routes/search.js";
import { systemRouter } from "./routes/system.js";
import { usersRouter } from "./routes/users.js";
import { chatRouter } from "./routes/chat.js";

export function createApp() {
  const app = express();
  app.use(
    cors({
      origin: config.corsOrigins,
      methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  );
  app.use(express.json());
  app.use(healthRouter);
  app.use(authRouter);

  const analytics = express.Router();
  analytics.use(requireAuth);
  analytics.use(overviewRouter);
  analytics.use(eventsRouter);
  analytics.use(funnelRouter);
  analytics.use(productsRouter);
  analytics.use(searchRouter);
  analytics.use(bannersRouter);
  analytics.use(revenueRouter);
  analytics.use(systemRouter);
  analytics.use(chatRouter);
  app.use(analytics);

  app.use(usersRouter);

  return app;
}
