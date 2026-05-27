function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

export const config = {
  port: Number(requireEnv("PORT")),
  corsOrigins: requireEnv("CORS_ORIGIN_DASHBOARD")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  jwtSecret: requireEnv("JWT_SECRET"),
  jwtExpires: requireEnv("JWT_EXPIRES"),
  adminEmail: requireEnv("DASHBOARD_ADMIN_EMAIL"),
  adminPassword: requireEnv("DASHBOARD_ADMIN_PASSWORD"),
  pipeline: {
    trackingApi: requireEnv("PIPELINE_TRACKING_API_URL"),
  },
  db: {
    host: requireEnv("POSTGRES_HOST"),
    port: Number(requireEnv("POSTGRES_PORT")),
    database: requireEnv("POSTGRES_DB"),
    user: requireEnv("POSTGRES_USER"),
    password: requireEnv("POSTGRES_PASSWORD"),
    max: 10,
    idleTimeoutMillis: 30000,
  },
  qdrant: {
    url: requireEnv("QDRANT_URL"),
    collection: requireEnv("QDRANT_COLLECTION"),
  },
  ollama: {
    url: requireEnv("OLLAMA_URL"),
    model: requireEnv("OLLAMA_MODEL"),
    timeout: Number(requireEnv("OLLAMA_TIMEOUT_MS")),
  },
};
