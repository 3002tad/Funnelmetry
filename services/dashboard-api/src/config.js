export const config = {
  port: Number(process.env.PORT || 3000),
  corsOrigins: (process.env.CORS_ORIGIN_DASHBOARD || process.env.CORS_ORIGIN || "http://localhost:5174,http://localhost:8090")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  jwtSecret: process.env.JWT_SECRET || "change-me-in-production",
  jwtExpires: process.env.JWT_EXPIRES || "7d",
  adminEmail: process.env.DASHBOARD_ADMIN_EMAIL || "admin@pipeline.local",
  adminPassword: process.env.DASHBOARD_ADMIN_PASSWORD || "admin123",
  pipeline: {
    trackingApi: process.env.PIPELINE_TRACKING_API_URL || "http://tracking-api:3000",
    commerceApi: process.env.PIPELINE_COMMERCE_API_URL || "http://commerce-backend:3000",
  },
  db: {
    host: process.env.POSTGRES_HOST || "localhost",
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || "realtime",
    user: process.env.POSTGRES_USER || "app",
    password: process.env.POSTGRES_PASSWORD || "app",
    max: 10,
    idleTimeoutMillis: 30000,
  },
  qdrant: {
    url: (process.env.QDRANT_URL || "").trim(),
    collection: process.env.QDRANT_COLLECTION || "pipeline_insights",
  },
  ollama: {
    url: (process.env.OLLAMA_URL || "").trim(),
    model: process.env.OLLAMA_MODEL || "qwen2.5:3b",
    timeout: Number(process.env.OLLAMA_TIMEOUT_MS || 60000),
  },
};
