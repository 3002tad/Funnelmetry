import test from "node:test"
import assert from "node:assert/strict"
import { loadConfig } from "../src/config.js"

const env = {
  KPI_PROJECTOR_INSTANCE_ID: "kpi-1",
  KAFKA_BOOTSTRAP_SERVERS: "kafka:9092",
  KAFKA_TOPIC_FUNNEL_UPDATED: "funnel-updated",
  KAFKA_TOPIC_KPI_UPDATED: "kpi-updated",
  POSTGRES_HOST: "postgres",
  POSTGRES_DB: "funnelmetry",
  POSTGRES_USER: "app",
  POSTGRES_PASSWORD: "secret",
}

test("loads KPI Kafka and PostgreSQL configuration", () => {
  const config = loadConfig(env)
  assert.equal(config.kafka.kpiUpdatedTopic, "kpi-updated")
  assert.equal(config.postgres.port, 5432)
})

test("requires a stable KPI transactional identity", () => {
  assert.throws(() => loadConfig({ ...env, KPI_PROJECTOR_INSTANCE_ID: "" }), /KPI_PROJECTOR_INSTANCE_ID is required/)
})
