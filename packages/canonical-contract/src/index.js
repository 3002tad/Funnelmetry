export const CANONICAL_EVENT_SPEC_VERSION = "canonical-event.v1"

export const CANONICAL_EVENT_CLASSES = Object.freeze([
  "BEHAVIOR_INTENT",
  "CLIENT_OBSERVATION",
  "BUSINESS_FACT",
])

export const CANONICALIZATION_STATUSES = Object.freeze([
  "normalized",
  "unsupported",
  "quarantined",
])

export const TIME_BASES = Object.freeze([
  "source_occurred",
  "source_produced",
  "ingress_fallback",
])

const sourceIdPattern = /^[a-z0-9][a-z0-9-]{2,62}$/
const eventIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{2,191}$/
const eventTypePattern = /^[a-z][a-z0-9]*(?:[._][a-z0-9]+)+$/
const sha256Pattern = /^[a-f0-9]{64}$/

function plainObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error(`${field} must be an object`)
  return value
}

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} must be a non-empty string`)
  return value.trim()
}

function timestamp(value, field) {
  const result = requiredString(value, field)
  if (Number.isNaN(Date.parse(result))) throw new Error(`${field} must be an ISO-8601 timestamp`)
  return result
}

function optionalObject(value, field) {
  return value === undefined ? undefined : plainObject(value, field)
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
  if (!value || typeof value !== "object") throw new Error(`${field} must contain JSON-compatible values`)
  if (seen.has(value)) throw new Error(`${field} must not contain circular data`)
  seen.add(value)
  for (const [key, nested] of Object.entries(value)) assertJsonValue(nested, `${field}.${key}`, seen)
  seen.delete(value)
}

function normalizeAggregate(value) {
  if (value === undefined) return undefined
  const aggregate = plainObject(value, "aggregate")
  const result = {
    type: requiredString(aggregate.type, "aggregate.type"),
    id: requiredString(aggregate.id, "aggregate.id"),
  }
  if (aggregate.version !== undefined) result.version = requiredString(String(aggregate.version), "aggregate.version")
  return result
}

function normalizeSourceReference(value) {
  const reference = plainObject(value, "source_reference")
  const contentHash = requiredString(reference.content_hash, "source_reference.content_hash")
  if (!sha256Pattern.test(contentHash)) throw new Error("source_reference.content_hash must be a lowercase SHA-256 hex digest")
  if (!Number.isSafeInteger(reference.byte_size) || reference.byte_size < 0) {
    throw new Error("source_reference.byte_size must be a non-negative integer")
  }
  return {
    raw_record_id: requiredString(reference.raw_record_id, "source_reference.raw_record_id"),
    content_hash: contentHash,
    byte_size: reference.byte_size,
  }
}

export function validateCanonicalEvent(input) {
  const value = plainObject(input, "CanonicalEvent")
  if (value.canonical_schema_version !== CANONICAL_EVENT_SPEC_VERSION) {
    throw new Error(`canonical_schema_version must be ${CANONICAL_EVENT_SPEC_VERSION}`)
  }
  const sourceId = requiredString(value.source_id, "source_id")
  if (!sourceIdPattern.test(sourceId)) throw new Error("source_id must be lowercase kebab-case")
  const sourceEventId = requiredString(value.source_event_id, "source_event_id")
  if (!eventIdPattern.test(sourceEventId)) throw new Error("source_event_id has unsupported characters or length")
  const eventType = requiredString(value.event_type, "event_type")
  if (!eventTypePattern.test(eventType)) throw new Error("event_type must use canonical dotted notation")
  const eventClass = requiredString(value.event_class, "event_class")
  if (!CANONICAL_EVENT_CLASSES.includes(eventClass)) throw new Error("event_class is unsupported")
  const quality = plainObject(value.quality, "quality")
  const timeBasis = requiredString(quality.time_basis, "quality.time_basis")
  if (!TIME_BASES.includes(timeBasis)) throw new Error("quality.time_basis is unsupported")
  if (typeof quality.authoritative_event_time !== "boolean") {
    throw new Error("quality.authoritative_event_time must be a boolean")
  }
  if (quality.authoritative_event_time !== (timeBasis === "source_occurred")) {
    throw new Error("quality.authoritative_event_time conflicts with quality.time_basis")
  }
  const data = plainObject(value.data, "data")
  assertJsonValue(data, "data")
  assertJsonValue(quality, "quality")

  const result = {
    canonical_event_id: requiredString(value.canonical_event_id, "canonical_event_id"),
    source_event_id: sourceEventId,
    event_type: eventType,
    event_class: eventClass,
    canonical_schema_version: CANONICAL_EVENT_SPEC_VERSION,
    mapping_version: requiredString(value.mapping_version, "mapping_version"),
    occurred_at: timestamp(value.occurred_at, "occurred_at"),
    ingested_at: timestamp(value.ingested_at, "ingested_at"),
    normalized_at: timestamp(value.normalized_at, "normalized_at"),
    source_id: sourceId,
    data,
    quality: {
      ...quality,
      time_basis: timeBasis,
      authoritative_event_time: quality.authoritative_event_time,
    },
    source_reference: normalizeSourceReference(value.source_reference),
  }
  if (value.produced_at !== undefined) result.produced_at = timestamp(value.produced_at, "produced_at")
  const aggregate = normalizeAggregate(value.aggregate)
  if (aggregate) result.aggregate = aggregate
  const relations = optionalObject(value.relations, "relations")
  if (relations) {
    assertJsonValue(relations, "relations")
    result.relations = relations
  }
  const identity = optionalObject(value.identity, "identity")
  if (identity) {
    assertJsonValue(identity, "identity")
    result.identity = identity
  }
  return Object.freeze(result)
}

export function validateCanonicalizationOutcome(input) {
  const value = plainObject(input, "CanonicalizationOutcome")
  const status = requiredString(value.status, "status")
  if (!CANONICALIZATION_STATUSES.includes(status)) throw new Error("canonicalization status is unsupported")
  const sourceId = requiredString(value.source_id, "source_id")
  if (!sourceIdPattern.test(sourceId)) throw new Error("source_id must be lowercase kebab-case")
  const sourceEventId = requiredString(value.source_event_id, "source_event_id")
  if (!eventIdPattern.test(sourceEventId)) throw new Error("source_event_id has unsupported characters or length")
  const result = {
    source_id: sourceId,
    source_event_id: sourceEventId,
    status,
    mapping_version: requiredString(value.mapping_version, "mapping_version"),
    processed_at: timestamp(value.processed_at, "processed_at"),
    raw_record_id: requiredString(value.raw_record_id, "raw_record_id"),
  }
  if (value.canonical_event_id !== undefined) {
    result.canonical_event_id = requiredString(value.canonical_event_id, "canonical_event_id")
  }
  if (value.reason_code !== undefined) result.reason_code = requiredString(value.reason_code, "reason_code")
  if (status === "normalized" && !result.canonical_event_id) {
    throw new Error("canonical_event_id is required for normalized")
  }
  if (status !== "normalized" && !result.reason_code) throw new Error(`reason_code is required for ${status}`)
  return Object.freeze(result)
}
