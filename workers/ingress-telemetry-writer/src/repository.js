import { validateCanonicalizationOutcome } from "@funnelmetry/canonical-contract"
import { validateIngressReceipt } from "@3002tad/funnelmetry-input-contract"

export class IngressTelemetryConflictError extends Error {
  constructor(kind, identity) {
    super(`${kind} ${identity} conflicts with immutable telemetry`)
    this.name = "IngressTelemetryConflictError"
    this.kind = kind
    this.identity = identity
  }
}

function recorded(result) {
  return new Date(result.rows[0].recorded_at).toISOString()
}

export function createIngressTelemetryRepository({ pool } = {}) {
  if (!pool || typeof pool.connect !== "function") throw new Error("A PostgreSQL pool is required")

  return Object.freeze({
    async persistReceipt(input) {
      const receipt = validateIngressReceipt(input)
      if (receipt.status !== "accepted") throw new Error("receipt telemetry topic must contain accepted receipts")
      const document = JSON.stringify(receipt)
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        const inserted = await client.query(
          `INSERT INTO ingress_accepted_receipts (
             source_id, event_id, ingestion_id, ingestion_attempt_id, received_at, receipt_document
           ) VALUES ($1,$2,$3,$4,$5,$6::jsonb)
           ON CONFLICT DO NOTHING RETURNING recorded_at`,
          [receipt.source_id, receipt.event_id, receipt.ingestion_id,
            receipt.ingestion_attempt_id ?? null, receipt.received_at, document],
        )
        if (inserted.rowCount === 1) {
          await client.query("COMMIT")
          return Object.freeze({ status: "inserted", recorded_at: recorded(inserted) })
        }
        const existing = await client.query(
          `SELECT receipt_document = $3::jsonb AS identical, recorded_at
             FROM ingress_accepted_receipts WHERE source_id = $1 AND event_id = $2`,
          [receipt.source_id, receipt.event_id, document],
        )
        if (existing.rowCount !== 1 || existing.rows[0].identical !== true) {
          throw new IngressTelemetryConflictError("receipt", `${receipt.source_id}:${receipt.event_id}`)
        }
        await client.query("COMMIT")
        return Object.freeze({ status: "duplicate", recorded_at: recorded(existing) })
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {})
        throw error
      } finally {
        client.release()
      }
    },

    async persistOutcome(input) {
      const outcome = validateCanonicalizationOutcome(input)
      const document = JSON.stringify(outcome)
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        const inserted = await client.query(
          `INSERT INTO canonicalization_outcomes (
             source_id, source_event_id, mapping_version, status, canonical_event_id,
             reason_code, processed_at, raw_record_id, outcome_document
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)
           ON CONFLICT DO NOTHING RETURNING recorded_at`,
          [outcome.source_id, outcome.source_event_id, outcome.mapping_version, outcome.status,
            outcome.canonical_event_id ?? null, outcome.reason_code ?? null,
            outcome.processed_at, outcome.raw_record_id, document],
        )
        if (inserted.rowCount === 1) {
          await client.query("COMMIT")
          return Object.freeze({ status: "inserted", recorded_at: recorded(inserted) })
        }
        const existing = await client.query(
          `SELECT outcome_document = $4::jsonb AS identical, recorded_at
             FROM canonicalization_outcomes
            WHERE source_id = $1 AND source_event_id = $2 AND mapping_version = $3`,
          [outcome.source_id, outcome.source_event_id, outcome.mapping_version, document],
        )
        if (existing.rowCount !== 1 || existing.rows[0].identical !== true) {
          throw new IngressTelemetryConflictError(
            "canonicalization outcome",
            `${outcome.source_id}:${outcome.source_event_id}:${outcome.mapping_version}`,
          )
        }
        await client.query("COMMIT")
        return Object.freeze({ status: "duplicate", recorded_at: recorded(existing) })
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {})
        throw error
      } finally {
        client.release()
      }
    },
  })
}
