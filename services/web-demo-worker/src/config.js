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
  orderQueue: requireEnv("RABBITMQ_ORDER_QUEUE"),
  orderBindingKey: process.env.RABBITMQ_ORDER_BINDING_KEY?.trim() || "order.created",
  processDelayMs: Number(process.env.WORKER_STEP_DELAY_MS || 800),
};
