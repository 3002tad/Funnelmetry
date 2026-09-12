function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

function envOptional(name, fallback = "") {
  const value = process.env[name];
  if (!value || !String(value).trim()) return fallback;
  return String(value).trim();
}

function featureFlag(name) {
  const value = envOptional(name, 'false');
  if (!['true', 'false'].includes(value)) throw new Error(`${name} must be true or false`);
  return value === 'true';
}
const features = Object.freeze({
  legacy: featureFlag('DASHBOARD_ENABLE_LEGACY'),
  ai: featureFlag('DASHBOARD_ENABLE_AI'),
});
const aiEnv = name => features.ai ? requireEnv(name) : '';

export const config = {
  features,
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
    trackingApi: features.legacy ? requireEnv("PIPELINE_TRACKING_API_URL") : '',
    commerceBackend: envOptional("PIPELINE_COMMERCE_BACKEND_URL", "http://commerce-backend:3000"),
    rabbitmqMgmt: envOptional("PIPELINE_RABBITMQ_MGMT_URL", "http://rabbitmq:15672"),
    rabbitmqUser: envOptional("RABBITMQ_MGMT_USER", "app"),
    rabbitmqPass: envOptional("RABBITMQ_MGMT_PASS", "app"),
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
    url: aiEnv("QDRANT_URL"),
    collection: aiEnv("QDRANT_COLLECTION"),
  },
  ollama: {
    url: aiEnv("OLLAMA_URL"),
    model: aiEnv("OLLAMA_MODEL"),
    timeout: features.ai ? Number(requireEnv("OLLAMA_TIMEOUT_MS")) : 0,
    temperature: Number(envOptional("OLLAMA_TEMPERATURE", "0.65")),
    numPredict: Number(envOptional("OLLAMA_NUM_PREDICT", "768")),
  },
  chat: {
    llmPlanner: envOptional("CHAT_LLM_PLANNER", "true") !== "false",
    plannerTimeoutMs: Number(envOptional("CHAT_PLANNER_TIMEOUT_MS", "12000")),
    polishTemperature: Number(envOptional("CHAT_POLISH_TEMPERATURE", "0.75")),
    polishNumPredict: Number(envOptional("CHAT_POLISH_NUM_PREDICT", "1024")),
  },
};
