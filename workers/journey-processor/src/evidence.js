const BUSINESS_ENTITIES = new Set(["cart", "checkout", "order", "payment"])
const RELATION_ENTITIES = Object.freeze({
  cart_id: "CART",
  checkout_id: "CHECKOUT",
  order_id: "ORDER",
  payment_id: "PAYMENT",
})

function nonEmpty(value) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function add(evidence, seen, item) {
  const key = `${item.entity_type}\u0000${item.entity_key}`
  if (seen.has(key)) return
  seen.add(key)
  evidence.push(Object.freeze(item))
}

export function extractJourneyEvidence(event) {
  const evidence = []
  const seen = new Set()
  const correlationId = nonEmpty(event.relations?.correlation_id)
  if (correlationId) add(evidence, seen, {
    entity_type: "CORRELATION",
    entity_key: correlationId,
    link_method: "DIRECT_CORRELATION",
    link_confidence: "STRONG",
    priority: 40,
  })

  if (event.aggregate && BUSINESS_ENTITIES.has(event.aggregate.type.toLowerCase())) {
    add(evidence, seen, {
      entity_type: event.aggregate.type.toUpperCase(),
      entity_key: event.aggregate.id,
      link_method: "BUSINESS_ENTITY",
      link_confidence: "STRONG",
      priority: 50,
    })
  }
  for (const [field, entityType] of Object.entries(RELATION_ENTITIES)) {
    const value = nonEmpty(event.relations?.[field])
    if (value) add(evidence, seen, {
      entity_type: entityType,
      entity_key: value,
      link_method: "BUSINESS_ENTITY",
      link_confidence: "STRONG",
      priority: 50,
    })
  }

  const userId = nonEmpty(event.identity?.user_id)
  if (userId) add(evidence, seen, {
    entity_type: "USER",
    entity_key: userId,
    link_method: "AUTHENTICATED_IDENTITY",
    link_confidence: "MEDIUM",
    priority: 20,
  })

  const sessionId = nonEmpty(event.identity?.session_id)
  if (sessionId) add(evidence, seen, {
    entity_type: "SESSION",
    entity_key: sessionId,
    link_method: "SESSION_CONTEXT",
    link_confidence: "WEAK",
    priority: 10,
  })

  return Object.freeze(evidence.sort((left, right) => right.priority - left.priority))
}
