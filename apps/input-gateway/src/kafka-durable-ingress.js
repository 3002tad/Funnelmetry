import { randomUUID } from "node:crypto"
import { validateIngressReceipt } from "@funnelmetry/input-contract"

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
      return withKeyLock(key, async () => {
        const existing = receiptIndex.get(event.source_id, event.event_id)
        if (existing) {
          return validateIngressReceipt({
            ...existing,
            status: "duplicate",
            ingestion_attempt_id: context.ingestion_attempt_id,
            received_at: context.received_at,
          })
        }

        const receipt = validateIngressReceipt({
          status: "accepted",
          source_id: event.source_id,
          event_id: event.event_id,
          ingestion_id: createIngestionId(),
          ingestion_attempt_id: context.ingestion_attempt_id,
          received_at: context.received_at,
        })
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

        const transaction = await producer.transaction()
        try {
          await transaction.send({
            topic: rawTopic,
            messages: [{ key, value: JSON.stringify(rawRecord) }],
          })
          await transaction.send({
            topic: receiptTopic,
            messages: [{ key, value: JSON.stringify(receipt) }],
          })
          await transaction.commit()
        } catch (error) {
          await transaction.abort().catch(() => {})
          throw error
        }

        receiptIndex.set(receipt)
        return receipt
      })
    },
  })
}
