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
  const config = loadConfig({ ...env, CANONICAL_NORMALIZER_MAPPING_CONFIG_PATH: "/mappings/medusa.json" })
  assert.deepEqual(config.brokers, ["kafka-1:9092", "kafka-2:9092"])
  assert.equal(config.consumerGroupId, "funnelmetry-canonical-normalizer-v1")
  assert.equal(config.mappingConfigPath, "/mappings/medusa.json")
})

test("requires a stable transactional instance identity and all output topics", () => {
  assert.throws(() => loadConfig({}), /CANONICAL_NORMALIZER_INSTANCE_ID is required/)
  assert.throws(() => loadConfig({ ...env, KAFKA_TOPIC_QUARANTINE: "" }), /KAFKA_TOPIC_QUARANTINE is required/)
})

test('explicit identity remains default; container mode is stable per container and distinct per replica', () => {
  assert.equal(loadConfig(env, 'ignored').instanceId, 'normalizer-1')
  const opts = { ...env, CANONICAL_NORMALIZER_INSTANCE_ID_MODE: 'container' }
  assert.equal(loadConfig(opts, 'abcdef012345').instanceId, 'normalizer-1-abcdef012345')
  assert.equal(loadConfig(opts, 'abcdef012345').instanceId, loadConfig(opts, 'abcdef012345').instanceId)
  assert.notEqual(loadConfig(opts, 'abcdef012345').instanceId, loadConfig(opts, 'abcdef012346').instanceId)
  assert.throws(() => loadConfig(opts, 'fixed-shared-hostname'), /Container identity/)
  assert.throws(() => loadConfig({ ...env, CANONICAL_NORMALIZER_INSTANCE_ID_MODE: 'auto' }), /Invalid/)
})
