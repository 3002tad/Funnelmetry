import test from "node:test"
import assert from "node:assert/strict"
import { loadConfig } from "../src/config.js"

const env = {
  CANONICAL_NORMALIZER_INSTANCE_ID: "normalizer-1",
  KAFKA_BOOTSTRAP_SERVERS: "kafka-1:9092,kafka-2:9092",
  KAFKA_TOPIC_RAW: "raw",
  KAFKA_TOPIC_CANONICAL: "canonical",
  KAFKA_TOPIC_CANONICALIZATION_OUTCOMES: "outcomes",
  KAFKA_TOPIC_QUARANTINE: "quarantine",
}

test("loads canonical-normalizer Kafka configuration", () => {
  const config = loadConfig(env)
  assert.deepEqual(config.brokers, ["kafka-1:9092", "kafka-2:9092"])
  assert.equal(config.consumerGroupId, "funnelmetry-canonical-normalizer-v1")
})

test("requires a stable transactional instance identity and all output topics", () => {
  assert.throws(() => loadConfig({}), /CANONICAL_NORMALIZER_INSTANCE_ID is required/)
  assert.throws(() => loadConfig({ ...env, KAFKA_TOPIC_QUARANTINE: "" }), /KAFKA_TOPIC_QUARANTINE is required/)
})
