export const config = {
  port: Number(process.env.PORT || 3000),
  kafkaBrokers: (process.env.KAFKA_BOOTSTRAP_SERVERS || "localhost:9092").split(","),
  kafkaTopicRaw: process.env.KAFKA_TOPIC_RAW || "tracking_events_raw",
  corsOrigins: (process.env.CORS_ORIGIN || "http://localhost:5173")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
};
