function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

export function validateFunnelUpdatedEnvelope(input, kafkaKey) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("funnel updated envelope must be an object")
  if (input.status !== "funnel_updated") throw new Error("funnel updated envelope status is invalid")
  if (!Array.isArray(input.updates)) throw new Error("funnel updates must be an array")
  const sourceId = requiredString(kafkaKey?.[0], "funnel Kafka key source_id")
  const journeyId = requiredString(input.journey_id, "journey_id")
  if (kafkaKey?.[1] !== journeyId) throw new Error("funnel Kafka key does not match journey_id")
  const instanceIds = input.updates.map((update, index) => requiredString(update?.funnel_instance_id, `updates[${index}].funnel_instance_id`))
  if (new Set(instanceIds).size !== instanceIds.length) throw new Error("funnel updates contain duplicate instance ids")
  return Object.freeze({
    triggerEventId: requiredString(input.canonical_event_id, "canonical_event_id"),
    sourceId,
    journeyId,
    instanceIds: Object.freeze(instanceIds),
  })
}
