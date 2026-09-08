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
  let producerIdentity
  let registrationAttempted = false

  return Object.freeze({
    async prepareProducerGeneration({ transactionalId, generationId }) {
      if (![transactionalId, generationId].every(value => typeof value === 'string' && value.trim())) {
        throw new Error('transactionalId and generationId are required')
      }
      if (registrationAttempted) throw new Error('create a new coordinator for a new generation startup')
      registrationAttempted = true
      await pool.query(
        `INSERT INTO ingress_producer_generations (transactional_id,generation_id,phase)
         VALUES ($1,$2,'INITIALIZING') ON CONFLICT (transactional_id) DO UPDATE
         SET generation_id = EXCLUDED.generation_id, phase = 'INITIALIZING', updated_at = NOW()`,
        [transactionalId, generationId],
      )
    },
    async readyProducerGeneration() {
      if (!producerIdentity) throw new Error('producer identity must be bound before ready')
      const updated = await pool.query(
        `UPDATE ingress_producer_generations SET phase = 'READY', updated_at = NOW()
         WHERE transactional_id = $1 AND generation_id = $2 AND phase = 'INITIALIZING'
         RETURNING generation_id`,
        [producerIdentity.transactionalId, producerIdentity.generationId],
      )
      if (updated.rowCount !== 1) throw new Error('producer generation superseded during startup')
    },
    // Bound by runtime only after transactional initialization succeeds.
    bindProducerIdentity({ transactionalId, generationId, kafkaScope = null }) {
      if (![transactionalId, generationId].every(value => typeof value === 'string' && value.trim())) {
        throw new Error('transactionalId and generationId are required')
      }
      if (kafkaScope !== null && !['clusterId', 'rawTopic', 'receiptTopic'].every(key =>
        typeof kafkaScope[key] === 'string' && kafkaScope[key].trim())) {
        throw new Error('complete Kafka recovery scope is required')
      }
      const scope = kafkaScope === null ? null : {
        clusterId: kafkaScope.clusterId, rawTopic: kafkaScope.rawTopic, receiptTopic: kafkaScope.receiptTopic,
      }
      if (producerIdentity && (producerIdentity.transactionalId !== transactionalId
        || producerIdentity.generationId !== generationId
        || JSON.stringify(producerIdentity.kafkaScope) !== JSON.stringify(scope))) {
        throw new Error('producer identity cannot change within one coordinator')
      }
      producerIdentity = Object.freeze({ transactionalId, generationId, kafkaScope: scope })
    },
    // Called only by startup after same-ID fencing and complete read_committed replay.
    async recoverFencedClaims({ replayOffsets }) {
      if (!producerIdentity?.kafkaScope) throw new Error('verified Kafka scope is required for recovery')
      if (!Array.isArray(replayOffsets) || replayOffsets.length === 0
        || !replayOffsets.every(row => Number.isSafeInteger(row.partition) && row.partition >= 0
          && typeof row.offset === 'string' && /^\d+$/.test(row.offset))
        || new Set(replayOffsets.map(row => row.partition)).size !== replayOffsets.length) {
        throw new Error('valid replay barrier offsets are required')
      }
      const { transactionalId, generationId, kafkaScope } = producerIdentity
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query("SET LOCAL statement_timeout = '5s'")
        const current = await client.query(
          `SELECT 1 FROM ingress_producer_generations
           WHERE transactional_id = $1 AND generation_id = $2 AND phase = 'INITIALIZING' FOR UPDATE`,
          [transactionalId, generationId])
        if (current.rowCount !== 1) throw new Error('recovery generation is no longer initializing')
        const recovered = await client.query(
          `WITH released AS (
             UPDATE ingress_receipt_claims claim
             SET owner_token = 'released', lease_expires_at = NOW(), updated_at = NOW()
             FROM ingress_send_attempts attempt
             WHERE claim.source_id = attempt.source_id AND claim.event_id = attempt.event_id
               AND claim.owner_token = attempt.owner_token AND claim.ingestion_id = attempt.ingestion_id
               AND claim.send_guard_owner_token = claim.owner_token AND claim.send_authorized = TRUE
               AND claim.claim_state = 'CLAIMED' AND claim.event_fingerprint IS NOT NULL
               AND attempt.transactional_id = $1 AND attempt.producer_generation_id <> $2
               AND attempt.kafka_scope = $3::jsonb
             RETURNING claim.source_id, claim.event_id, attempt.owner_token, claim.ingestion_id,
                       attempt.producer_generation_id
           )
           INSERT INTO ingress_claim_recoveries
             (source_id,event_id,owner_token,ingestion_id,transactional_id,previous_generation_id,
              recovery_generation_id,kafka_scope,replay_offsets)
           SELECT source_id,event_id,owner_token,ingestion_id,$1,producer_generation_id,$2,$3::jsonb,$4::jsonb
           FROM released RETURNING event_id`,
          [transactionalId, generationId, JSON.stringify(kafkaScope), JSON.stringify(replayOffsets)])
        await client.query('COMMIT')
        return { recovered: recovered.rowCount }
      } catch (error) {
        await client.query('ROLLBACK').catch(() => {})
        throw error
      } finally { client.release() }
    },
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
             claim_state, owner_token, lease_expires_at, send_authorized, send_guard_owner_token
           ) VALUES ($1,$2,$3,$4,$5::jsonb,'CLAIMED',$6,$7,FALSE,$6)
           ON CONFLICT (source_id, event_id) DO NOTHING`,
          [event.source_id, event.event_id, fingerprint, validatedReceipt.ingestion_id,
            JSON.stringify(validatedReceipt), ownerToken, leaseExpiresAt.toISOString()],
        )
        const selected = await client.query(
          `SELECT *, lease_expires_at <= NOW() AS lease_expired FROM ingress_receipt_claims
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
        // An expired lease is insufficient once send permission was granted.
        // The owner-bound guard also excludes legacy writers without this protocol.
        const recoverBeforeSend = row.send_authorized === false
          && row.send_guard_owner_token === row.owner_token && row.lease_expired
        if (row.owner_token !== 'released' && !recoverBeforeSend) {
          await client.query("COMMIT")
          return result("pending", row)
        }
        const takeover = await client.query(
          `UPDATE ingress_receipt_claims
              SET owner_token = $3, lease_expires_at = $4, updated_at = NOW(),
                  send_authorized = FALSE, send_guard_owner_token = $3
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

    // Must succeed exactly once before opening a Kafka transaction. This UPDATE
    // and claim takeover serialize on the same row, fencing a paused old owner.
    async authorizeSend({ source_id: sourceId, event_id: eventId, owner_token: ownerToken }) {
      if (!producerIdentity) throw new Error('producer identity must be bound before send authorization')
      const updated = await pool.query(
        `WITH active_generation AS (
           SELECT generation_id FROM ingress_producer_generations
           WHERE transactional_id = $4 AND generation_id = $5 AND phase = 'READY'
           FOR SHARE
         ), authorized AS (
           UPDATE ingress_receipt_claims SET send_authorized = TRUE, updated_at = NOW()
           WHERE source_id = $1 AND event_id = $2 AND owner_token = $3
             AND send_guard_owner_token = $3 AND send_authorized = FALSE AND claim_state = 'CLAIMED'
             AND EXISTS (SELECT 1 FROM active_generation)
           RETURNING source_id, event_id, owner_token, ingestion_id
         )
         INSERT INTO ingress_send_attempts
           (source_id,event_id,owner_token,ingestion_id,transactional_id,producer_generation_id,kafka_scope)
         SELECT source_id,event_id,owner_token,ingestion_id,$4,$5,$6::jsonb FROM authorized
         RETURNING ingestion_id`,
        [sourceId, eventId, ownerToken, producerIdentity.transactionalId, producerIdentity.generationId,
          producerIdentity.kafkaScope === null ? null : JSON.stringify(producerIdentity.kafkaScope)],
      )
      if (updated.rowCount !== 1) {
        const active = await pool.query(
          `SELECT 1 FROM ingress_producer_generations
           WHERE transactional_id = $1 AND generation_id = $2 AND phase = 'READY'`,
          [producerIdentity.transactionalId, producerIdentity.generationId],
        )
        if (active.rowCount === 0) {
          const error = new Error('producer generation is not active')
          error.code = 'INGRESS_GENERATION_REVOKED'
          throw error
        }
        throw new Error("ingress send authorization denied")
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
