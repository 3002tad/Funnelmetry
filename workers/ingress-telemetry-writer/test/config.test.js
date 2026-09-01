import assert from "node:assert/strict"
import test from "node:test"
import { loadConfig } from "../src/config.js"

const env = {
  INGRESS_TELEMETRY_INSTANCE_ID: "telemetry-1",
  KAFKA_BOOTSTRAP_SERVERS: "kafka-a:9092,kafka-b:9092",
  KAFKA_TOPIC_INGRESS_RECEIPTS: "receipts",
  KAFKA_TOPIC_CANONICALIZATION_OUTCOMES: "outcomes",
  POSTGRES_HOST: "postgres",
  POSTGRES_PORT: "5432",
  POSTGRES_DB: "funnelmetry",
  POSTGRES_USER: "app",
  POSTGRES_PASSWORD: "secret",
}

test("loads ingress telemetry Kafka and PostgreSQL configuration", () => {
  const config = loadConfig(env)
  assert.deepEqual(config.kafka.brokers, ["kafka-a:9092", "kafka-b:9092"])
  assert.equal(config.kafka.receiptTopic, "receipts")
  assert.equal(config.kafka.outcomeTopic, "outcomes")
  assert.equal(config.postgres.host, "postgres")
})

test("requires a stable telemetry instance identity", () => {
  assert.throws(() => loadConfig({ ...env, INGRESS_TELEMETRY_INSTANCE_ID: "bad id" }), /unsupported characters/)
})
