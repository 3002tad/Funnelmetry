const { Kafka } = require("kafkajs");

const kafka = new Kafka({
  clientId: "dashboard-api",
  brokers: (process.env.KAFKA_BOOTSTRAP_SERVERS || "kafka:9092").split(","),
  connectionTimeout: 3000,
  requestTimeout: 5000,
  retry: { retries: 1 },
  logLevel: 0,
});

const kafkaAdmin = kafka.admin();

module.exports = { kafkaAdmin };
