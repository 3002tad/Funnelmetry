function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

function optionalEnv(name, fallback = "") {
  const value = process.env[name];
  if (value == null || !String(value).trim()) return fallback;
  return String(value).trim();
}

export const config = {
  port: Number(requireEnv("PORT")),
  ingestApiKey: optionalEnv("TRACKING_INGEST_API_KEY"),
  enableBusinessIngest: optionalEnv("ENABLE_BUSINESS_EVENT_INGEST", "true") === "true",
  kafkaBrokers: requireEnv("KAFKA_BOOTSTRAP_SERVERS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
  kafkaTopicRaw: requireEnv("KAFKA_TOPIC_RAW"),
  corsOrigins: requireEnv("CORS_ORIGIN")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};
