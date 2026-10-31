import assert from "node:assert/strict"
import test from "node:test"
import { loadMappingRegistry } from "../src/mapping-loader.js"

test("Medusa source-native producer mapping is empty after CDC cutover", async () => {
  const mappingPath = new URL("../../../integrations/medusa/canonical-mappings.v2.json", import.meta.url)
  const registry = await loadMappingRegistry(mappingPath)
  assert.equal(registry.resolve({
    source_id: "medusa-reference",
    source_event_type: "medusa.order_placed",
    source_schema_version: "2.0",
  }), undefined)
  assert.ok(registry.size > 0, "generic canonical mappings remain available")
})
