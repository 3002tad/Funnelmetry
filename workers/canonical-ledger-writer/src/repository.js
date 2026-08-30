import { validateCanonicalEvent } from "@funnelmetry/canonical-contract"

export class CanonicalLedgerConflictError extends Error {
  constructor(canonicalEventId) {
    super(`canonical event ${canonicalEventId} conflicts with the immutable ledger`)
    this.name = "CanonicalLedgerConflictError"
    this.canonicalEventId = canonicalEventId
  }
}

const INSERT_EVENT = `
  INSERT INTO canonical_events (
    canonical_event_id, source_id, source_event_id, event_type, event_class,
    canonical_schema_version, mapping_version, occurred_at, produced_at, ingested_at,
    normalized_at, aggregate_type, aggregate_id, aggregate_version, relations, identity,
    data, quality, raw_record_id, raw_content_hash, raw_byte_size, canonical_document
  ) VALUES (
    $1, $2, $3, $4, $5,
    $6, $7, $8, $9, $10,
    $11, $12, $13, $14, $15::jsonb, $16::jsonb,
    $17::jsonb, $18::jsonb, $19, $20, $21, $22::jsonb
  )
  ON CONFLICT DO NOTHING
  RETURNING canonical_event_id, persisted_at
`

function json(value) {
  return value === undefined ? null : JSON.stringify(value)
}

function insertParameters(event, document) {
  return [
    event.canonical_event_id,
    event.source_id,
    event.source_event_id,
    event.event_type,
    event.event_class,
    event.canonical_schema_version,
    event.mapping_version,
    event.occurred_at,
    event.produced_at ?? null,
    event.ingested_at,
    event.normalized_at,
    event.aggregate?.type ?? null,
    event.aggregate?.id ?? null,
    event.aggregate?.version ?? null,
    json(event.relations),
    json(event.identity),
    json(event.data),
    json(event.quality),
    event.source_reference.raw_record_id,
    event.source_reference.content_hash,
    event.source_reference.byte_size,
    document,
  ]
}

export function createCanonicalLedgerRepository({ pool } = {}) {
  if (!pool || typeof pool.connect !== "function") throw new Error("A PostgreSQL pool is required")

  return Object.freeze({
    async persist(input) {
      const event = validateCanonicalEvent(input)
      const document = JSON.stringify(event)
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        const inserted = await client.query(INSERT_EVENT, insertParameters(event, document))
        if (inserted.rowCount === 1) {
          await client.query("COMMIT")
          return Object.freeze({
            status: "inserted",
            canonical_event_id: event.canonical_event_id,
            persisted_at: new Date(inserted.rows[0].persisted_at).toISOString(),
          })
        }

        const existing = await client.query(
          `SELECT canonical_document = $2::jsonb AS identical, persisted_at
             FROM canonical_events
            WHERE canonical_event_id = $1`,
          [event.canonical_event_id, document],
        )
        if (existing.rowCount !== 1 || existing.rows[0].identical !== true) {
          throw new CanonicalLedgerConflictError(event.canonical_event_id)
        }
        await client.query("COMMIT")
        return Object.freeze({
          status: "duplicate",
          canonical_event_id: event.canonical_event_id,
          persisted_at: new Date(existing.rows[0].persisted_at).toISOString(),
        })
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {})
        throw error
      } finally {
        client.release()
      }
    },
  })
}
