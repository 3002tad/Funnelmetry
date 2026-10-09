import cors from "cors";
import express from "express";
import { isAdminApiPath, isChatApiPath, isShopApiPath, skipUnlessZone } from "./lib/api-zones.js";
import { config } from "./config.js";
import { requireAuth, requireChatRole, requireShopRole } from "./middleware/auth.js";
import { authRouter } from "./routes/auth.js";
import { accountRouter } from './routes/account.js';
import { createChatV2Router } from './routes/chat-v2.js';
import { healthRouter } from "./routes/health.js";
import { createMachineMonitoringRouter, createMonitoringCredentialRouter } from './routes/monitoring.js';
import { createMonitoringAlertsRouter } from './routes/monitoring-alerts.js';
import { usersRouter } from "./routes/users.js";
import { analyticsV2Router } from "./routes/analytics-v2.js";
import { createAdminV2Router } from "./routes/admin-v2.js";
import { createCatalogV2Router } from './routes/catalog-v2.js';
import { createRunDiagnosticsRouter } from './routes/run-diagnostics.js';
import { createEvidenceV2Router } from './routes/evidence-v2.js';
import { createProductsV2Router } from './routes/products-v2.js';
import { requireLivePermission } from "./middleware/live-permission.js";
import { requireAnalyticsCapability } from './middleware/analytics-capability.js';
import { requireLiveSession } from './middleware/live-session.js';

const legacyRouters = config.features.legacy ? await Promise.all([
  import('./routes/overview.js').then(m => m.overviewRouter),
  import('./routes/events.js').then(m => m.eventsRouter),
  import('./routes/funnel.js').then(m => m.funnelRouter),
  import('./routes/products.js').then(m => m.productsRouter),
  import('./routes/search.js').then(m => m.searchRouter),
  import('./routes/banners.js').then(m => m.bannersRouter),
  import('./routes/revenue.js').then(m => m.revenueRouter),
]) : [];
const systemRouter = config.features.legacy ? (await import('./routes/system.js')).systemRouter : null;
const chatRouter = config.features.ai ? (await import('./routes/chat.js')).chatRouter : null;
const insightsRouter = config.features.ai ? (await import('./routes/insights.js')).insightsRouter : null;

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
  app.use(createMachineMonitoringRouter());
  // Apply session revocation to every authenticated API, including legacy routes.
  app.use((req, res, next) => {
    if (req.path === '/api/auth/login' && req.method === 'POST') return next();
    if (!req.path.toLowerCase().startsWith('/api/')) return next();
    return requireAuth(req, res, () => requireLiveSession()(req, res, next));
  });
  app.use(authRouter);
  app.use(accountRouter);
  app.use(createMonitoringCredentialRouter());
  app.use(createMonitoringAlertsRouter());
  app.use(createChatV2Router());
  app.use(createAdminV2Router());
  app.use(createCatalogV2Router());
  app.use(createRunDiagnosticsRouter());
  app.use(createEvidenceV2Router());
  app.use(createProductsV2Router());

  // Insights are business reads, never part of user/system administration.
  app.use('/api/chat/insights', requireLivePermission('insight.read'), (req, res, next) => {
    if (!insightsRouter) return res.status(503).json({ error: 'module_disabled', module: 'ai' });
    next();
  });
  if (insightsRouter) app.use(insightsRouter);

  const shop = express.Router();
  shop.use(skipUnlessZone(isShopApiPath));
  shop.use(requireAuth, requireLivePermission('analytics.read'), requireShopRole);
  shop.use(requireAnalyticsCapability);
  shop.use(analyticsV2Router);
  for (const router of legacyRouters) shop.use(router);
  if (!config.features.legacy) shop.use((req, res, next) => {
    if (req.path.startsWith('/api/v2/analytics')) return next();
    return res.status(503).json({ error: 'module_disabled', module: 'legacy' });
  });
  app.use(shop);

  const chatApi = express.Router();
  chatApi.use(skipUnlessZone(isChatApiPath));
  chatApi.use(requireAuth, requireLivePermission('chat.use'), requireChatRole);
  if (chatRouter) chatApi.use(chatRouter);
  else chatApi.use((_req, res) => res.status(503).json({ error: 'module_disabled', module: 'ai' }));
  app.use(chatApi);

  const adminOps = express.Router();
  adminOps.use(skipUnlessZone(isAdminApiPath));
  adminOps.use('/api/system', requireLivePermission('pipeline.monitor'), (_req, res, next) => {
    if (!systemRouter) return res.status(503).json({ error: 'module_disabled', module: 'legacy' });
    next();
  });
  if (systemRouter) adminOps.use(systemRouter);
  adminOps.use(requireAuth, requireLivePermission('user.manage'));
  adminOps.use(usersRouter);
  app.use(adminOps);

  return app;
}
