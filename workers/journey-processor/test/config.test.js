import test from "node:test"
import assert from "node:assert/strict"
import { loadConfig } from "../src/config.js"

const env = {
  JOURNEY_PROCESSOR_INSTANCE_ID: "journey-1",
  KAFKA_BOOTSTRAP_SERVERS: "kafka:9092",
  KAFKA_TOPIC_CANONICAL_PERSISTED: "canonical-persisted",
  KAFKA_TOPIC_JOURNEY_RESOLVED: "journey-resolved",
  POSTGRES_HOST: "postgres",
  POSTGRES_DB: "funnelmetry",
  POSTGRES_USER: "app",
  POSTGRES_PASSWORD: "secret",
}

test("loads journey Kafka and PostgreSQL configuration", () => {
  const config = loadConfig(env)
  assert.equal(config.kafka.resolvedTopic, "journey-resolved")
  assert.equal(config.postgres.port, 5432)
})

test("requires a stable journey transactional identity", () => {
  assert.throws(() => loadConfig({ ...env, JOURNEY_PROCESSOR_INSTANCE_ID: "" }), /JOURNEY_PROCESSOR_INSTANCE_ID is required/)
})
