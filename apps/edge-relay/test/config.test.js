import assert from "node:assert/strict"
import test from "node:test"
import { loadConfig } from "../src/config.js"

function env(overrides = {}) {
  return {
    SOURCE_INGRESS_BROWSER_KEYS_JSON: '{"medusa-reference-source":{"source_id":"medusa-reference","secret":"browser-secret","allowed_origins":["https://shop.example.test"]}}',
    SOURCE_INGRESS_BACKEND_KEYS_JSON: '{"medusa-reference-source":{"source_id":"medusa-reference","secret":"backend-secret"}}',
    SOURCE_INGRESS_EVENT_FEED_TOKENS_JSON: '{"pipeline-connector":"read-token"}',
    ...overrides,
  }
}

test("loads only Source Ingress configuration and its separate producer/read credentials", () => {
  const config = loadConfig(env({ RELAY_UPSTREAM_ENABLED: "true", RELAY_UPSTREAM_INGRESS_URL: "https://must-not-be-read.example.test" }))
  assert.equal(config.port, 32000)
  assert.equal(config.browserKeys["medusa-reference-source"].secret, "browser-secret")
  assert.equal(config.backendKeys["medusa-reference-source"].secret, "backend-secret")
  assert.equal(config.eventFeedTokens["pipeline-connector"], "read-token")
  assert.equal(Object.hasOwn(config, "upstream"), false)
})

test("requires a non-empty Event Feed credential registry", () => {
  assert.throws(() => loadConfig(env({ SOURCE_INGRESS_EVENT_FEED_TOKENS_JSON: "{}" })), /must map token IDs/)
})
