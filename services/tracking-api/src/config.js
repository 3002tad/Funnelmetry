function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

export const config = {
  port: Number(requireEnv("PORT")),
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
