function requireEnv(name) {
  const value = process.env[name];
  if (!value || !String(value).trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return String(value).trim();
}

export const config = {
  port: Number(requireEnv("PORT")),
  rabbitmqUrl: requireEnv("RABBITMQ_URL"),
  exchange: requireEnv("RABBITMQ_EXCHANGE"),
  exchangeType: process.env.RABBITMQ_EXCHANGE_TYPE?.trim() || "topic",
  corsOrigins: requireEnv("CORS_ORIGIN")
    .split(",").map((s) => s.trim()).filter(Boolean),
};
