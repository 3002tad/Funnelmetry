import assert from "node:assert/strict"
import test from "node:test"
import { loadMappingRegistry } from "../src/mapping-loader.js"

test("integration mapping artifact is source-scoped and conservative", async () => {
  const mappingPath = new URL("../../../integrations/medusa/canonical-mappings.v1.json", import.meta.url)
  const registry = await loadMappingRegistry(mappingPath)
  const mapping = registry.resolve({
    source_id: "medusa-reference",
    source_event_type: "medusa.order_placed",
    source_schema_version: "2.0",
  })

  assert.equal(mapping.event_type, "order.placed")
  assert.equal(mapping.event_class, "BUSINESS_FACT")
  assert.equal(mapping.mapping_version, "medusa-order-placed-v2")
  assert.equal(registry.resolve({ source_id: 'medusa-reference', source_event_type: 'medusa.order_placed', source_schema_version: '1.0' }), undefined)
  assert.equal(registry.resolve({
    source_id: "another-shop",
    source_event_type: "medusa.order_placed",
    source_schema_version: "1.0",
  }), undefined)
})
