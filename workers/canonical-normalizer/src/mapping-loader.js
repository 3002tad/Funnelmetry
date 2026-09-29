import { readFile } from "node:fs/promises"
import { validateMedusaOrder } from './medusa-order.js'
import { createMappingRegistry, createPassthroughMappings } from "./mapping-registry.js"

export async function loadMappingRegistry(mappingConfigPath) {
  if (!mappingConfigPath) return createMappingRegistry()

  let document
  try {
    document = JSON.parse(await readFile(mappingConfigPath, "utf8"))
  } catch (error) {
    throw new Error(`Cannot load canonical mapping config: ${error instanceof Error ? error.message : "unknown error"}`)
  }
  if (document?.schema_version !== "canonical-mappings.v1") {
    throw new Error("Canonical mapping config must use canonical-mappings.v1")
  }
  if (typeof document.source_id !== "string" || document.source_id.trim() === "") {
    throw new Error("Canonical mapping config source_id is required")
  }
  if (!Array.isArray(document.mappings) || document.mappings.length === 0) {
    throw new Error("Canonical mapping config requires at least one mapping")
  }

  const sourceMappings = document.mappings.map((mapping) => {
    if (mapping.payload_contract && mapping.payload_contract !== 'medusa-order-major-v2') throw Error('Unknown mapping payload contract')
    return ({
    source_id: document.source_id,
    source_event_type: mapping.source_event_type,
    source_schema_version: mapping.source_schema_version,
    event_type: mapping.event_type,
    event_class: mapping.event_class,
    mapping_version: mapping.mapping_version,
    map_data: mapping.payload_contract === 'medusa-order-major-v2' ? validateMedusaOrder : (event) => event.source_payload,
    map_relations: mapping.payload_contract === 'medusa-order-major-v2'
      ? (event) => ({ cart_id: event.source_payload.cart_id, order_id: event.source_payload.order_id }) : undefined,
  })})
  return createMappingRegistry([...sourceMappings, ...createPassthroughMappings()])
}
