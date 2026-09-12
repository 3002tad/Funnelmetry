import {
  BEHAVIOR_EVENT_DEFINITIONS,
  validateBehaviorPayload,
} from "@3002tad/funnelmetry-behavior-event-catalog"

const BASELINE_SEMANTICS = Object.freeze({
  ...Object.fromEntries(Object.entries(BEHAVIOR_EVENT_DEFINITIONS).map(([eventType, definition]) => [eventType, definition.event_class])),
  "payment.submit_clicked": "BEHAVIOR_INTENT",
  "cart.item_added": "BUSINESS_FACT",
  "order.created": "BUSINESS_FACT",
  "order.accepted": "BUSINESS_FACT",
  "order.cancelled": "BUSINESS_FACT",
  "payment.attempted": "BUSINESS_FACT",
  "payment.captured": "BUSINESS_FACT",
  "payment.failed": "BUSINESS_FACT",
  "payment.cancelled": "BUSINESS_FACT",
  "refund.completed": "BUSINESS_FACT",
})

export function createPassthroughMappings(mappingVersion = "canonical-passthrough-v2") {
  return Object.entries(BASELINE_SEMANTICS).map(([eventType, eventClass]) => Object.freeze({
    source_id: "*",
    source_event_type: eventType,
    source_schema_version: "*",
    event_type: eventType,
    event_class: eventClass,
    mapping_version: mappingVersion,
    map_data: (event) => (
      Object.hasOwn(BEHAVIOR_EVENT_DEFINITIONS, eventType)
        ? validateBehaviorPayload(eventType, event.source_payload)
        : event.source_payload
    ),
  }))
}

function score(mapping, event) {
  if (mapping.source_id !== "*" && mapping.source_id !== event.source_id) return -1
  if (mapping.source_event_type !== event.source_event_type) return -1
  if (mapping.source_schema_version !== "*" && mapping.source_schema_version !== event.source_schema_version) return -1
  return Number(mapping.source_id !== "*") * 2 + Number(mapping.source_schema_version !== "*")
}

export function createMappingRegistry(mappings = createPassthroughMappings()) {
  const values = [...mappings]
  for (const mapping of values) {
    if (!mapping?.source_id || !mapping.source_event_type || !mapping.source_schema_version) {
      throw new Error("Every semantic mapping requires source selectors")
    }
    if (!mapping.event_type || !mapping.event_class || !mapping.mapping_version || typeof mapping.map_data !== "function") {
      throw new Error("Every semantic mapping requires canonical semantics and map_data")
    }
  }

  return Object.freeze({
    resolve(event) {
      return values
        .map((mapping) => ({ mapping, score: score(mapping, event) }))
        .filter((candidate) => candidate.score >= 0)
        .sort((left, right) => right.score - left.score)[0]?.mapping
    },
    size: values.length,
  })
}
