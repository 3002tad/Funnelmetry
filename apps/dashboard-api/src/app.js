import cors from "cors";
import express from "express";
import { isAdminApiPath, isChatApiPath, isShopApiPath, skipUnlessZone } from "./lib/api-zones.js";
import { config } from "./config.js";
import { requireAuth, requireAdminRole, requireChatRole, requireShopRole } from "./middleware/auth.js";
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

  const shop = express.Router();
  shop.use(skipUnlessZone(isShopApiPath));
  shop.use(requireAuth, requireShopRole);
  shop.use(overviewRouter);
  shop.use(eventsRouter);
  shop.use(funnelRouter);
  shop.use(productsRouter);
  shop.use(searchRouter);
  shop.use(bannersRouter);
  shop.use(revenueRouter);
  app.use(shop);

  const chatApi = express.Router();
  chatApi.use(skipUnlessZone(isChatApiPath));
  chatApi.use(requireAuth, requireChatRole);
  chatApi.use(chatRouter);
  app.use(chatApi);

  const adminOps = express.Router();
  adminOps.use(skipUnlessZone(isAdminApiPath));
  adminOps.use(requireAuth, requireAdminRole);
  adminOps.use(systemRouter);
  adminOps.use(usersRouter);
  app.use(adminOps);

  return app;
}
