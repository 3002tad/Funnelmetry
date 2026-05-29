function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

export const config = {
  rabbitmqUrl: requireEnv("RABBITMQ_URL"),
  exchange: requireEnv("RABBITMQ_EXCHANGE"),
  exchangeType: process.env.RABBITMQ_EXCHANGE_TYPE?.trim() || "topic",
  adapterQueue: requireEnv("ADAPTER_QUEUE"),
  bindingKeys: requireEnv("ADAPTER_BINDING_KEYS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  ingestUrl: requireEnv("TRACKING_BACKEND_INGEST_URL"),
  ingestApiKey: requireEnv("TRACKING_INGEST_API_KEY"),
  tenantId: process.env.TENANT_ID?.trim() || "web_demo_local",
  source: process.env.ADAPTER_SOURCE?.trim() || "rabbitmq_adapter",
  batchSize: Number(process.env.BATCH_SIZE || 10),
  flushMs: Number(process.env.FLUSH_MS || 500),
};
