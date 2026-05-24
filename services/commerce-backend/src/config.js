export const config = {
  port: Number(process.env.PORT || 3000),
  rabbitmqUrl: process.env.RABBITMQ_URL || "amqp://app:app@localhost:5672",
  exchange: process.env.RABBITMQ_EXCHANGE || "commerce_events",
  corsOrigins: (process.env.CORS_ORIGIN || "http://localhost:3000")
    .split(",").map((s) => s.trim()).filter(Boolean),
};
