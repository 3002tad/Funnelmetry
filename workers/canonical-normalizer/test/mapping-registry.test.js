import assert from "node:assert/strict"
import test from "node:test"
import {
  createMappingRegistry,
  createMedusaOrderPlacedMappings,
} from "../src/mapping-registry.js"

test("Medusa order.placed mapping is source-scoped and conservative", () => {
  const registry = createMappingRegistry(createMedusaOrderPlacedMappings(["medusa-reference"]))
  const mapping = registry.resolve({
    source_id: "medusa-reference",
    source_event_type: "medusa.order_placed",
    source_schema_version: "1.0",
  })

  assert.equal(mapping.event_type, "order.created")
  assert.equal(mapping.event_class, "BUSINESS_FACT")
  assert.equal(mapping.mapping_version, "medusa-v2-order-placed-to-order-created.v1")
  assert.equal(registry.resolve({
    source_id: "another-shop",
    source_event_type: "medusa.order_placed",
    source_schema_version: "1.0",
  }), undefined)
})
