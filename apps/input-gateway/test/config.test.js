import test from "node:test"
import assert from "node:assert/strict"
import { loadConfig } from "../src/config.js"

function validEnv() {
  return {
    INPUT_GATEWAY_INSTANCE_ID: "gateway-1",
    INPUT_GATEWAY_BROWSER_KEYS_JSON: JSON.stringify({ browser: { source_id: "shop", secret: "write-key" } }),
    INPUT_GATEWAY_BACKEND_KEYS_JSON: JSON.stringify({ bridge: { source_id: "shop", secret: "hmac-key" } }),
    KAFKA_BOOTSTRAP_SERVERS: "kafka-1:9092,kafka-2:9092",
    KAFKA_TOPIC_RAW: "funnelmetry.raw.v1",
    KAFKA_TOPIC_INGRESS_RECEIPTS: "funnelmetry.ingress.receipts.v1",
  }
}

test("loads a complete gateway configuration", () => {
  const config = loadConfig({
    ...validEnv(),
    INPUT_GATEWAY_PORT: "31001",
    INPUT_GATEWAY_CORS_ORIGINS: "http://localhost:8000, http://localhost:9000",
  })

  assert.equal(config.port, 31001)
  assert.deepEqual(config.kafka.brokers, ["kafka-1:9092", "kafka-2:9092"])
  assert.deepEqual(config.corsOrigins, ["http://localhost:8000", "http://localhost:9000"])
  assert.equal(config.backendKeys.bridge.secret, "hmac-key")
})

test("rejects missing Kafka and credential configuration", () => {
  assert.throws(() => loadConfig({}), /INPUT_GATEWAY_INSTANCE_ID is required/)
  assert.throws(
    () => loadConfig({ ...validEnv(), INPUT_GATEWAY_BACKEND_KEYS_JSON: "{}", KAFKA_TOPIC_RAW: "" }),
    /KAFKA_TOPIC_RAW is required/,
  )
})

test("rejects malformed credentials without exposing their value", () => {
  assert.throws(
    () => loadConfig({ ...validEnv(), INPUT_GATEWAY_BROWSER_KEYS_JSON: "not-json-secret" }),
    /^Error: INPUT_GATEWAY_BROWSER_KEYS_JSON must be valid JSON$/,
  )
})
