import { createHash, randomUUID } from "node:crypto"
import { validateIngressReceipt } from "@3002tad/funnelmetry-input-contract"

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]))
  }
  return value
}

export function fingerprintIngressEvent(event) {
  return createHash("sha256").update(JSON.stringify(stableValue(event))).digest("hex")
}

function result(status, row, ownerToken = null) {
  return Object.freeze({
    status,
    owner_token: ownerToken,
    receipt: row?.receipt_document ? validateIngressReceipt(row.receipt_document) : null,
  })
}

export function createPostgresReceiptCoordinator({
  pool,
  instanceId,
  leaseMs = 30_000,
  now = () => new Date(),
  createOwnerToken = randomUUID,
} = {}) {
  if (!pool || typeof pool.connect !== "function") throw new Error("PostgreSQL pool is required")
  if (typeof instanceId !== "string" || !instanceId.trim()) throw new Error("instanceId is required")
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new Error("leaseMs must be a positive integer")

  return Object.freeze({
    // Only the read_committed receipt consumer may call this recovery path.
    async confirmReceipt(input) {
      const receipt = validateIngressReceipt(input)
      if (receipt.status !== 'accepted') throw new Error('recovery requires an accepted Kafka receipt')
      const updated = await pool.query(
        `UPDATE ingress_receipt_claims SET claim_state = 'ACCEPTED', updated_at = NOW()
         WHERE source_id = $1 AND event_id = $2 AND ingestion_id = $3
           AND receipt_document = $4::jsonb RETURNING *`,
        [receipt.source_id, receipt.event_id, receipt.ingestion_id, JSON.stringify(receipt)],
      )
      if (updated.rowCount === 1) return result('accepted', updated.rows[0])
      const existing = await pool.query(
        'SELECT ingestion_id FROM ingress_receipt_claims WHERE source_id = $1 AND event_id = $2',
        [receipt.source_id, receipt.event_id],
      )
      if (existing.rowCount) throw new Error('Kafka receipt conflicts with coordination claim')
      // Historical receipts may predate coordination; do not invent a fingerprint.
      return result('untracked', null)
    },
    async adopt({ event, receipt }) {
      const validatedReceipt = validateIngressReceipt({ ...receipt, status: "accepted" })
      const fingerprint = fingerprintIngressEvent(event)
      const inserted = await pool.query(
        `UPDATE ingress_receipt_claims SET claim_state = 'ACCEPTED', updated_at = NOW()
         WHERE source_id = $1 AND event_id = $2
           AND ingestion_id = $4 AND event_fingerprint = $3
         RETURNING *`,
        [event.source_id, event.event_id, fingerprint, validatedReceipt.ingestion_id],
      )
      const row = inserted.rows[0]
      if (!row) {
        const existing = await pool.query(
          'SELECT * FROM ingress_receipt_claims WHERE source_id = $1 AND event_id = $2',
          [event.source_id, event.event_id],
        )
        const evidence = existing.rows[0]
        return result(!evidence || evidence.event_fingerprint === null ? 'pending' : 'conflict', evidence)
      }
      return result("duplicate", row)
    },

    async claim({ event, receipt }) {
      const validatedReceipt = validateIngressReceipt(receipt)
      const fingerprint = fingerprintIngressEvent(event)
      const ownerToken = `${instanceId}:${createOwnerToken()}`
      const claimedAt = now()
      const leaseExpiresAt = new Date(claimedAt.getTime() + leaseMs)
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        await client.query(
          `INSERT INTO ingress_receipt_claims (
             source_id, event_id, event_fingerprint, ingestion_id, receipt_document,
             claim_state, owner_token, lease_expires_at
           ) VALUES ($1,$2,$3,$4,$5::jsonb,'CLAIMED',$6,$7)
           ON CONFLICT (source_id, event_id) DO NOTHING`,
          [event.source_id, event.event_id, fingerprint, validatedReceipt.ingestion_id,
            JSON.stringify(validatedReceipt), ownerToken, leaseExpiresAt.toISOString()],
        )
        const selected = await client.query(
          `SELECT * FROM ingress_receipt_claims
            WHERE source_id = $1 AND event_id = $2 FOR UPDATE`,
          [event.source_id, event.event_id],
        )
        const row = selected.rows[0]
        if (row.event_fingerprint === null && row.claim_state === "ACCEPTED") {
          await client.query("COMMIT")
          return result("pending", row)
        }
        if (row.event_fingerprint !== fingerprint) {
          await client.query("COMMIT")
          return result("conflict", row)
        }
        if (row.claim_state === "ACCEPTED") {
          await client.query("COMMIT")
          return result("duplicate", row)
        }
        if (row.owner_token === ownerToken) {
          await client.query("COMMIT")
          return result("claimed", row, ownerToken)
        }
        // Expiration cannot prove the previous Kafka transaction did not commit.
        // Only an explicit release before commit was attempted permits another send.
        if (row.owner_token !== 'released') {
          await client.query("COMMIT")
          return result("pending", row)
        }
        const takeover = await client.query(
          `UPDATE ingress_receipt_claims
              SET owner_token = $3, lease_expires_at = $4, updated_at = NOW()
            WHERE source_id = $1 AND event_id = $2
            RETURNING *`,
          [event.source_id, event.event_id, ownerToken, leaseExpiresAt.toISOString()],
        )
        await client.query("COMMIT")
        return result("claimed", takeover.rows[0], ownerToken)
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      } finally {
        client.release()
      }
    },

    async complete({ source_id: sourceId, event_id: eventId, owner_token: ownerToken }) {
      const updated = await pool.query(
        `UPDATE ingress_receipt_claims
            SET claim_state = 'ACCEPTED', updated_at = NOW()
          WHERE source_id = $1 AND event_id = $2 AND owner_token = $3 AND claim_state IN ('CLAIMED', 'ACCEPTED')
          RETURNING *`,
        [sourceId, eventId, ownerToken],
      )
      if (updated.rowCount !== 1) throw new Error("ingress receipt claim ownership was lost")
      return result("accepted", updated.rows[0])
    },

    async release({ source_id: sourceId, event_id: eventId, owner_token: ownerToken }) {
      await pool.query(
        `UPDATE ingress_receipt_claims SET owner_token = 'released', lease_expires_at = NOW(), updated_at = NOW()
          WHERE source_id = $1 AND event_id = $2 AND owner_token = $3 AND claim_state = 'CLAIMED'`,
        [sourceId, eventId, ownerToken],
      )
    },
  })
}
