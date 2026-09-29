import {
  BEHAVIOR_EVENT_DEFINITIONS,
  BEHAVIOR_SOURCE_SCHEMA_VERSION,
  validateBehaviorPayload,
} from "@3002tad/funnelmetry-behavior-event-catalog"

const BASELINE_SEMANTICS = Object.freeze({
  ...Object.fromEntries(Object.entries(BEHAVIOR_EVENT_DEFINITIONS).map(([eventType, definition]) => [eventType, definition.event_class])),
  "payment.submit_clicked": "BEHAVIOR_INTENT",
  "cart.item_added": "BUSINESS_FACT",
  "order.created": "BUSINESS_FACT",
  "order.placed": "BUSINESS_FACT",
  "order.accepted": "BUSINESS_FACT",
  "order.cancelled": "BUSINESS_FACT",
  "payment.attempted": "BUSINESS_FACT",
  "payment.captured": "BUSINESS_FACT",
  "payment.failed": "BUSINESS_FACT",
  "payment.cancelled": "BUSINESS_FACT",
  "refund.completed": "BUSINESS_FACT",
})

export function createPassthroughMappings(mappingVersion = "canonical-passthrough-v2") {
  const mappings = Object.entries(BASELINE_SEMANTICS).map(([eventType, eventClass]) => Object.freeze({
    source_id: "*",
    source_event_type: eventType,
    source_schema_version: Object.hasOwn(BEHAVIOR_EVENT_DEFINITIONS, eventType) ? BEHAVIOR_SOURCE_SCHEMA_VERSION : "*",
    event_type: eventType,
    event_class: eventClass,
    mapping_version: Object.hasOwn(BEHAVIOR_EVENT_DEFINITIONS, eventType) ? 'canonical-behavior-v2' : mappingVersion,
    map_data: (event) => {
      if (eventType === 'order.placed' && event.producer !== 'source_bridge') throw new Error('Order placement requires source authority')
      const definition = BEHAVIOR_EVENT_DEFINITIONS[eventType]
      if (!definition) return event.source_payload
      const producer = definition.producer === 'source_server' ? 'source_bridge' : 'browser_sdk'
      if (event.producer !== producer) throw new Error('Behavior producer does not match Catalog v2')
      return validateBehaviorPayload(eventType, event.source_payload)
    },
  }))
  // The deployed reference browser still labels unchanged payloads as schema 1.0.
  // Source-scoped binding only: never restore retired add-click or browser search.
  const referenceBrowserMappings = mappings
    .filter(mapping => BEHAVIOR_EVENT_DEFINITIONS[mapping.event_type]?.producer === 'browser')
    .map(mapping => Object.freeze({ ...mapping, source_id: 'medusa-reference',
      source_schema_version: '1.0', mapping_version: 'medusa-browser-schema1-catalog-v2' }))
  return [...mappings, ...referenceBrowserMappings]
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
