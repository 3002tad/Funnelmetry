import test from "node:test"
import assert from "node:assert/strict"
import { loadConfig } from "../src/config.js"

const required = {
  MATURITY_SCHEDULER_INSTANCE_ID: "maturity-1",
  POSTGRES_HOST: "postgres",
  POSTGRES_DB: "funnelmetry",
  POSTGRES_USER: "funnelmetry",
  POSTGRES_PASSWORD: "local-password",
}

test("loads bounded maturity scheduler configuration", () => {
  const config = loadConfig(required)
  assert.equal(config.instanceId, "maturity-1")
  assert.equal(config.pollIntervalMs, 5_000)
  assert.equal(config.batchSize, 100)
  assert.equal(config.finalizationEnabled, false)
  assert.equal(config.postgres.port, 5432)
})

test("rejects invalid scheduler identity and polling values", () => {
  assert.throws(() => loadConfig({ ...required, MATURITY_SCHEDULER_INSTANCE_ID: "bad id" }), /unsupported/)
  assert.throws(() => loadConfig({ ...required, MATURITY_SCHEDULER_BATCH_SIZE: "0" }), /positive integer/)
  assert.throws(() => loadConfig({ ...required, MATURITY_SCHEDULER_POSTGRES_POOL_SIZE: "1" }), /at least 2/)
  assert.throws(() => loadConfig({ ...required, MATURITY_SCHEDULER_FINALIZATION_ENABLED: "yes" }), /true or false/)
})
