import test from "node:test"
import assert from "node:assert/strict"
import { loadConfig } from "../src/config.js"

const env = {
  FUNNEL_PROCESSOR_INSTANCE_ID: "funnel-1",
  KAFKA_BOOTSTRAP_SERVERS: "kafka:9092",
  KAFKA_TOPIC_JOURNEY_RESOLVED: "journey-resolved",
  KAFKA_TOPIC_FUNNEL_UPDATED: "funnel-updated",
  POSTGRES_HOST: "postgres",
  POSTGRES_DB: "funnelmetry",
  POSTGRES_USER: "app",
  POSTGRES_PASSWORD: "secret",
}

test("loads funnel Kafka and PostgreSQL configuration", () => {
  const config = loadConfig(env)
  assert.equal(config.kafka.updatedTopic, "funnel-updated")
  assert.equal(config.postgres.port, 5432)
})

test("requires a stable funnel transactional identity", () => {
  assert.throws(() => loadConfig({ ...env, FUNNEL_PROCESSOR_INSTANCE_ID: "" }), /FUNNEL_PROCESSOR_INSTANCE_ID is required/)
})
