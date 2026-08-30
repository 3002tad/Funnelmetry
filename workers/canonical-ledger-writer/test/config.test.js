import test from "node:test"
import assert from "node:assert/strict"
import { loadConfig } from "../src/config.js"

const env = {
  CANONICAL_LEDGER_INSTANCE_ID: "ledger-1",
  KAFKA_BOOTSTRAP_SERVERS: "kafka:9092",
  KAFKA_TOPIC_CANONICAL: "canonical",
  KAFKA_TOPIC_CANONICAL_PERSISTED: "canonical-persisted",
  POSTGRES_HOST: "postgres",
  POSTGRES_DB: "funnelmetry",
  POSTGRES_USER: "app",
  POSTGRES_PASSWORD: "secret",
}

test("loads Kafka and PostgreSQL ledger configuration", () => {
  const config = loadConfig(env)
  assert.equal(config.kafka.canonicalTopic, "canonical")
  assert.equal(config.postgres.port, 5432)
  assert.equal(config.postgres.max, 5)
})

test("rejects incomplete database configuration", () => {
  assert.throws(() => loadConfig({ ...env, POSTGRES_PASSWORD: "" }), /POSTGRES_PASSWORD is required/)
})
