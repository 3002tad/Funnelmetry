export const INGRESS_EVENT_SPEC_VERSION = "ingress-event.v1"
export const RELAY_RECEIPT_SPEC_VERSION = "relay-receipt.v1"

export const RECEIPT_STATUSES = Object.freeze([
  "accepted",
  "duplicate",
  "rejected",
  "retryable_failure",
])

export const RELAY_RECEIPT_STATUSES = Object.freeze(["relay_queued"])

const sourceIdPattern = /^[a-z0-9][a-z0-9-]{2,62}$/
const eventIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,191}$/
const producers = new Set(["browser_sdk", "source_bridge"])
const forbiddenPayloadKeys = new Set([
  "address",
  "card_number",
  "cvv",
  "email",
  "password",
  "payment_token",
  "phone",
  "raw_ip",
])

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} must be a non-empty string`)
  }
  return value.trim()
}

function optionalTimestamp(value, field) {
  if (value === undefined || value === null) return undefined
  const timestamp = requiredString(value, field)
  if (Number.isNaN(Date.parse(timestamp))) throw new Error(`${field} must be an ISO-8601 timestamp`)
  return timestamp
}

function assertJsonValue(value, field, seen = new WeakSet()) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`${field} must not contain a non-finite number`)
    return
  }
  if (Array.isArray(value)) {
    for (const item of value) assertJsonValue(item, field, seen)
    return
  }
  if (!isPlainObject(value)) throw new Error(`${field} must contain JSON-compatible values`)
  if (seen.has(value)) throw new Error(`${field} must not contain circular data`)
  seen.add(value)
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenPayloadKeys.has(key.toLowerCase())) {
      throw new Error(`${field} must not contain sensitive field '${key}'`)
    }
    assertJsonValue(nested, `${field}.${key}`, seen)
  }
  seen.delete(value)
}

function serializedSize(value, field, maxPayloadBytes) {
  let serialized
  try {
    serialized = JSON.stringify(value)
  } catch {
    throw new Error(`${field} must be JSON serializable`)
  }
  const bytes = new TextEncoder().encode(serialized).byteLength
  if (bytes > maxPayloadBytes) throw new Error(`${field} exceeds ${maxPayloadBytes} bytes`)
}

function normalizeAggregate(value) {
  if (value === undefined) return undefined
  if (!isPlainObject(value)) throw new Error("aggregate must be an object")
  const type = requiredString(value.type, "aggregate.type")
  const id = requiredString(value.id, "aggregate.id")
  const version = value.version === undefined ? undefined : requiredString(String(value.version), "aggregate.version")
  return version === undefined ? { type, id } : { type, id, version }
}

/**
 * Validates the immutable raw event that crosses the customer/Funnelmetry boundary.
 * It deliberately validates source facts only; canonical semantics belong downstream.
 */
export function validateIngressEvent(input, options = {}) {
  const { maxPayloadBytes = 64 * 1024, requireOccurredAt = true } = options
  if (!isPlainObject(input)) throw new Error("IngressEvent must be an object")
  if (input.specversion !== INGRESS_EVENT_SPEC_VERSION) {
    throw new Error(`specversion must be ${INGRESS_EVENT_SPEC_VERSION}`)
  }

  const sourceId = requiredString(input.source_id, "source_id")
  if (!sourceIdPattern.test(sourceId)) throw new Error("source_id must be lowercase kebab-case")
  const eventId = requiredString(input.event_id, "event_id")
  if (!eventIdPattern.test(eventId)) throw new Error("event_id has unsupported characters or length")
  const sourceEventType = requiredString(input.source_event_type, "source_event_type")
  const sourceSchemaVersion = requiredString(input.source_schema_version, "source_schema_version")
  const producer = requiredString(input.producer, "producer")
  if (!producers.has(producer)) throw new Error("producer is unsupported by IngressEvent v1")
  const occurredAt = optionalTimestamp(input.occurred_at, "occurred_at")
  if (requireOccurredAt && occurredAt === undefined) throw new Error("occurred_at is required by this integration profile")
  const producedAt = optionalTimestamp(input.produced_at, "produced_at")
  if (!isPlainObject(input.source_payload)) throw new Error("source_payload must be an object")
  assertJsonValue(input.source_payload, "source_payload")
  serializedSize(input.source_payload, "source_payload", maxPayloadBytes)

  let sourceMetadata
  if (input.source_metadata !== undefined) {
    if (!isPlainObject(input.source_metadata)) throw new Error("source_metadata must be an object")
    assertJsonValue(input.source_metadata, "source_metadata")
    serializedSize(input.source_metadata, "source_metadata", maxPayloadBytes)
    sourceMetadata = input.source_metadata
  }

  const result = {
    specversion: INGRESS_EVENT_SPEC_VERSION,
    source_id: sourceId,
    event_id: eventId,
    source_event_type: sourceEventType,
    source_schema_version: sourceSchemaVersion,
    producer,
    source_payload: input.source_payload,
  }
  if (occurredAt !== undefined) result.occurred_at = occurredAt
  if (producedAt !== undefined) result.produced_at = producedAt
  if (input.anonymous_id !== undefined) result.anonymous_id = requiredString(input.anonymous_id, "anonymous_id")
  if (input.session_id !== undefined) result.session_id = requiredString(input.session_id, "session_id")
  if (input.correlation_id !== undefined) result.correlation_id = requiredString(input.correlation_id, "correlation_id")
  if (sourceMetadata !== undefined) result.source_metadata = sourceMetadata
  const aggregate = normalizeAggregate(input.aggregate)
  if (aggregate !== undefined) result.aggregate = aggregate
  return Object.freeze(result)
}

export function createIngressEvent(input, options) {
  return validateIngressEvent(input, options)
}

export function validateIngressReceipt(input) {
  if (!isPlainObject(input)) throw new Error("Ingress receipt must be an object")
  const status = requiredString(input.status, "status")
  if (!RECEIPT_STATUSES.includes(status)) throw new Error("receipt.status is unsupported")
  const sourceId = requiredString(input.source_id, "receipt.source_id")
  const eventId = requiredString(input.event_id, "receipt.event_id")
  if (!sourceIdPattern.test(sourceId)) throw new Error("receipt.source_id must be lowercase kebab-case")
  if (!eventIdPattern.test(eventId)) throw new Error("receipt.event_id has unsupported characters or length")
  const receivedAt = optionalTimestamp(input.received_at, "receipt.received_at")
  if (receivedAt === undefined) throw new Error("receipt.received_at is required")
  const result = { status, source_id: sourceId, event_id: eventId, received_at: receivedAt }
  if (input.ingestion_id !== undefined) result.ingestion_id = requiredString(input.ingestion_id, "receipt.ingestion_id")
  if (input.ingestion_attempt_id !== undefined) result.ingestion_attempt_id = requiredString(input.ingestion_attempt_id, "receipt.ingestion_attempt_id")
  if (input.reason_code !== undefined) result.reason_code = requiredString(input.reason_code, "receipt.reason_code")
  if ((status === "accepted" || status === "duplicate") && !result.ingestion_id) {
    throw new Error(`receipt.ingestion_id is required for ${status}`)
  }
  return Object.freeze(result)
}

/**
 * Relay durability is deliberately separate from Pipeline/Kafka durability.
 */
export function validateRelayReceipt(input) {
  if (!isPlainObject(input)) throw new Error("Relay receipt must be an object")
  if (input.specversion !== RELAY_RECEIPT_SPEC_VERSION) {
    throw new Error(`relay receipt.specversion must be ${RELAY_RECEIPT_SPEC_VERSION}`)
  }
  const status = requiredString(input.status, "relay receipt.status")
  if (!RELAY_RECEIPT_STATUSES.includes(status)) throw new Error("relay receipt.status is unsupported")
  const relayId = requiredString(input.relay_id, "relay receipt.relay_id")
  const sourceId = requiredString(input.source_id, "relay receipt.source_id")
  const eventId = requiredString(input.event_id, "relay receipt.event_id")
  const receivedAt = optionalTimestamp(input.relay_received_at, "relay receipt.relay_received_at")
  if (!sourceIdPattern.test(sourceId)) throw new Error("relay receipt.source_id must be lowercase kebab-case")
  if (!eventIdPattern.test(eventId)) throw new Error("relay receipt.event_id has unsupported characters or length")
  if (receivedAt === undefined) throw new Error("relay receipt.relay_received_at is required")
  return Object.freeze({
    specversion: RELAY_RECEIPT_SPEC_VERSION,
    status,
    relay_id: relayId,
    source_id: sourceId,
    event_id: eventId,
    relay_received_at: receivedAt,
  })
}

export function isTerminalReceipt(status) {
  return status === "accepted" || status === "duplicate" || status === "rejected"
}
