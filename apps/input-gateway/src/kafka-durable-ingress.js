import { randomUUID } from "node:crypto"
import { validateIngressReceipt } from "@3002tad/funnelmetry-input-contract"

function eventKey(sourceId, eventId) {
  return JSON.stringify([sourceId, eventId])
}

export function createReceiptIndex() {
  const receipts = new Map()
  let ready = false

  return Object.freeze({
    get(sourceId, eventId) {
      return receipts.get(eventKey(sourceId, eventId))
    },
    set(receipt) {
      const validated = validateIngressReceipt(receipt)
      if (validated.status !== "accepted" && validated.status !== "duplicate") {
        throw new Error("receipt index only stores durable receipts")
      }
      receipts.set(eventKey(validated.source_id, validated.event_id), validated)
      return validated
    },
    hydrate(values) {
      if (ready) throw new Error("receipt index is already ready")
      for (const value of values) this.set(value)
    },
    markReady() {
      ready = true
    },
    markNotReady() {
      ready = false
    },
    isReady() {
      return ready
    },
    size() {
      return receipts.size
    },
  })
}

function createKeyLock() {
  const tails = new Map()

  return async function withKeyLock(key, operation) {
    const previous = tails.get(key) ?? Promise.resolve()
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const tail = previous.then(() => gate)
    tails.set(key, tail)
    await previous
    try {
      return await operation()
    } finally {
      release()
      if (tails.get(key) === tail) tails.delete(key)
    }
  }
}

export function createKafkaDurableIngress({
  producer,
  receiptIndex,
  receiptCoordinator,
  rawTopic,
  receiptTopic,
  createIngestionId = () => `ing_${randomUUID()}`,
} = {}) {
  if (!producer || typeof producer.transaction !== "function") {
    throw new Error("A transactional Kafka producer is required")
  }
  if (!receiptIndex || typeof receiptIndex.get !== "function" || typeof receiptIndex.set !== "function") {
    throw new Error("A receipt index is required")
  }
  if (!rawTopic || !receiptTopic) throw new Error("Raw and receipt Kafka topics are required")
  const withKeyLock = createKeyLock()

  return Object.freeze({
    isReady() {
      return receiptIndex.isReady?.() === true
    },
    async accept(event, context) {
      if (receiptIndex.isReady?.() !== true) throw new Error("receipt index is not ready")
      const key = eventKey(event.source_id, event.event_id)
      // KafkaJS supports one transaction at a time per producer, including distinct keys.
      return withKeyLock('producer', async () => {
        if (receiptIndex.isReady?.() !== true) throw new Error("receipt index is not ready")
        const existing = receiptIndex.get(event.source_id, event.event_id)
        if (existing) {
          if (receiptCoordinator) {
            const adopted = await receiptCoordinator.adopt({ event, receipt: existing })
            if (adopted.status === 'pending') throw new Error('original event fingerprint is unavailable')
            if (adopted.status === "conflict") {
              return validateIngressReceipt({
                status: "rejected", source_id: event.source_id, event_id: event.event_id,
                ingestion_attempt_id: context.ingestion_attempt_id, received_at: context.received_at,
                reason_code: "event_identity_conflict",
              })
            }
          }
          return validateIngressReceipt({
            ...existing,
            status: "duplicate",
            ingestion_attempt_id: context.ingestion_attempt_id,
            received_at: context.received_at,
          })
        }

        let receipt = validateIngressReceipt({
          status: "accepted",
          source_id: event.source_id,
          event_id: event.event_id,
          ingestion_id: createIngestionId(),
          ingestion_attempt_id: context.ingestion_attempt_id,
          received_at: context.received_at,
        })
        let ownerToken = null
        if (receiptCoordinator) {
          const claim = await receiptCoordinator.claim({ event, receipt })
          if (claim.status === "duplicate") {
            receiptIndex.set(claim.receipt)
            return validateIngressReceipt({
              ...claim.receipt,
              status: "duplicate",
              ingestion_attempt_id: context.ingestion_attempt_id,
              received_at: context.received_at,
            })
          }
          if (claim.status === "conflict") {
            return validateIngressReceipt({
              status: "rejected",
              source_id: event.source_id,
              event_id: event.event_id,
              ingestion_attempt_id: context.ingestion_attempt_id,
              received_at: context.received_at,
              reason_code: "event_identity_conflict",
            })
          }
          if (claim.status === "pending") throw new Error("ingress receipt claim is in progress")
          receipt = claim.receipt
          ownerToken = claim.owner_token
        }
        const rawRecord = {
          ingestion_id: receipt.ingestion_id,
          ingestion_attempt_id: receipt.ingestion_attempt_id,
          received_at: receipt.received_at,
          auth: {
            key_id: context.auth?.key_id,
            method: context.auth?.method,
          },
          raw_body: context.raw_body,
        }

        let transaction
        let commitAttempted = false
        // Keep this outside the abort/release handler: an ambiguous DB response
        // or stale owner must not undo an authorization granted elsewhere.
        if (ownerToken) {
          try {
            await receiptCoordinator.authorizeSend({
              source_id: event.source_id, event_id: event.event_id, owner_token: ownerToken,
            })
          } catch (error) {
            if (error.code === 'INGRESS_GENERATION_REVOKED') receiptIndex.markNotReady()
            throw error
          }
        }
        try {
          transaction = await producer.transaction()
          await transaction.send({
            topic: rawTopic,
            messages: [{ key, value: JSON.stringify(rawRecord) }],
          })
          await transaction.send({
            topic: receiptTopic,
            messages: [{ key, value: JSON.stringify(receipt) }],
          })
          commitAttempted = true
          await transaction.commit()
        } catch (error) {
          let aborted = !transaction
          if (transaction) {
            try { await transaction.abort(); aborted = true } catch {}
          }
          if (ownerToken && !commitAttempted && aborted) {
            await receiptCoordinator.release({
              source_id: event.source_id, event_id: event.event_id, owner_token: ownerToken,
            }).catch(() => {})
          }
          const fenced = error.type === 'INVALID_PRODUCER_EPOCH' || error.type === 'PRODUCER_FENCED'
            || error.code === 47 || error.code === 90
          if (commitAttempted || !aborted || fenced) receiptIndex.markNotReady()
          throw error
        }

        // Preserve broker-confirmed evidence even if PostgreSQL completion fails.
        receiptIndex.set(receipt)
        if (ownerToken) {
          await receiptCoordinator.complete({
            source_id: event.source_id, event_id: event.event_id, owner_token: ownerToken,
          })
        }
        return receipt
      })
    },
  })
}
