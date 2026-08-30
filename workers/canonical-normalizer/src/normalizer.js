import { createHash } from "node:crypto"
import { validateIngressEvent } from "@funnelmetry/input-contract"
import {
  CANONICAL_EVENT_SPEC_VERSION,
  validateCanonicalEvent,
  validateCanonicalizationOutcome,
} from "@funnelmetry/canonical-contract"
import { createMappingRegistry } from "./mapping-registry.js"

function sha256(value) {
  return createHash("sha256").update(value).digest("hex")
}

function parseKey(key) {
  try {
    const [sourceId, sourceEventId] = JSON.parse(Buffer.isBuffer(key) ? key.toString("utf8") : String(key))
    if (typeof sourceId === "string" && typeof sourceEventId === "string") return { sourceId, sourceEventId }
  } catch {}
  throw new Error("raw Kafka key must contain [source_id,event_id]")
}

function parseRawRecord(value, fallbackRawRecordId) {
  const record = JSON.parse(Buffer.isBuffer(value) ? value.toString("utf8") : String(value))
  if (!record || typeof record !== "object" || Array.isArray(record)) throw new Error("raw record must be an object")
  if (typeof record.raw_body !== "string") throw new Error("raw record.raw_body must be a string")
  if (typeof record.received_at !== "string" || Number.isNaN(Date.parse(record.received_at))) {
    throw new Error("raw record.received_at must be an ISO-8601 timestamp")
  }
  const rawRecordId = typeof record.ingestion_id === "string" && record.ingestion_id
    ? record.ingestion_id
    : fallbackRawRecordId
  return { ...record, rawRecordId }
}

function referenceFor(rawBody, rawRecordId) {
  return Object.freeze({
    raw_record_id: rawRecordId,
    content_hash: sha256(rawBody),
    byte_size: Buffer.byteLength(rawBody, "utf8"),
  })
}

function timeSemantics(event, ingestedAt) {
  if (event.occurred_at) {
    return { occurredAt: event.occurred_at, timeBasis: "source_occurred", authoritative: true }
  }
  if (event.produced_at) {
    return { occurredAt: event.produced_at, timeBasis: "source_produced", authoritative: false }
  }
  return { occurredAt: ingestedAt, timeBasis: "ingress_fallback", authoritative: false }
}

function outcomeBase({ sourceId, sourceEventId, rawRecordId, mappingVersion, processedAt }) {
  return {
    source_id: sourceId,
    source_event_id: sourceEventId,
    mapping_version: mappingVersion,
    processed_at: processedAt,
    raw_record_id: rawRecordId,
  }
}

function quarantine({ base, reasonCode, sourceReference, detail }) {
  const outcome = validateCanonicalizationOutcome({
    ...base,
    status: "quarantined",
    reason_code: reasonCode,
  })
  return Object.freeze({
    status: "quarantined",
    outcome,
    quarantine: Object.freeze({
      ...base,
      reason_code: reasonCode,
      detail,
      source_reference: sourceReference,
    }),
  })
}

export function createNormalizer({
  registry = createMappingRegistry(),
  now = () => new Date().toISOString(),
  unmappedVersion = "unmapped-v1",
} = {}) {
  return Object.freeze({
    normalize({ key, value, rawRecordIdFallback = "unknown-raw-record" }) {
      const { sourceId, sourceEventId } = parseKey(key)
      const processedAt = now()
      let rawRecord
      try {
        rawRecord = parseRawRecord(value, rawRecordIdFallback)
      } catch (error) {
        const body = Buffer.isBuffer(value) ? value.toString("utf8") : String(value)
        const sourceReference = referenceFor(body, rawRecordIdFallback)
        return quarantine({
          base: outcomeBase({ sourceId, sourceEventId, rawRecordId: rawRecordIdFallback, mappingVersion: unmappedVersion, processedAt }),
          reasonCode: "raw_record_invalid",
          sourceReference,
          detail: error.message,
        })
      }

      const sourceReference = referenceFor(rawRecord.raw_body, rawRecord.rawRecordId)
      const base = outcomeBase({
        sourceId,
        sourceEventId,
        rawRecordId: rawRecord.rawRecordId,
        mappingVersion: unmappedVersion,
        processedAt,
      })
      let event
      try {
        event = validateIngressEvent(JSON.parse(rawRecord.raw_body), { requireOccurredAt: false })
        if (event.source_id !== sourceId || event.event_id !== sourceEventId) {
          throw new Error("raw Kafka key does not match IngressEvent identity")
        }
      } catch (error) {
        return quarantine({ base, reasonCode: "ingress_event_invalid", sourceReference, detail: error.message })
      }

      const mapping = registry.resolve(event)
      if (!mapping) {
        const outcome = validateCanonicalizationOutcome({
          ...base,
          status: "unsupported",
          reason_code: "mapping_not_found",
        })
        return Object.freeze({
          status: "unsupported",
          outcome,
          quarantine: Object.freeze({
            ...base,
            reason_code: "mapping_not_found",
            source_event_type: event.source_event_type,
            source_schema_version: event.source_schema_version,
            source_reference: sourceReference,
          }),
        })
      }

      try {
        const time = timeSemantics(event, rawRecord.received_at)
        const identity = {}
        if (event.anonymous_id) identity.anonymous_id = event.anonymous_id
        if (event.session_id) identity.session_id = event.session_id
        const relations = event.correlation_id ? { correlation_id: event.correlation_id } : undefined
        const canonicalEvent = validateCanonicalEvent({
          canonical_event_id: `can_${sha256(JSON.stringify([sourceId, sourceEventId, mapping.mapping_version]))}`,
          source_event_id: sourceEventId,
          event_type: mapping.event_type,
          event_class: mapping.event_class,
          canonical_schema_version: CANONICAL_EVENT_SPEC_VERSION,
          mapping_version: mapping.mapping_version,
          occurred_at: time.occurredAt,
          produced_at: event.produced_at,
          ingested_at: rawRecord.received_at,
          normalized_at: processedAt,
          source_id: sourceId,
          aggregate: event.aggregate,
          relations,
          identity: Object.keys(identity).length ? identity : undefined,
          data: mapping.map_data(event),
          quality: {
            time_basis: time.timeBasis,
            authoritative_event_time: time.authoritative,
          },
          source_reference: sourceReference,
        })
        const outcome = validateCanonicalizationOutcome({
          ...base,
          mapping_version: mapping.mapping_version,
          status: "normalized",
          canonical_event_id: canonicalEvent.canonical_event_id,
        })
        return Object.freeze({ status: "normalized", outcome, canonicalEvent })
      } catch (error) {
        return quarantine({
          base: { ...base, mapping_version: mapping.mapping_version },
          reasonCode: "mapping_failed",
          sourceReference,
          detail: error.message,
        })
      }
    },
  })
}
