import { Kafka, logLevel, Partitioners } from "kafkajs"
import { validateCanonicalEvent } from "@funnelmetry/canonical-contract"

export function createKafkaLedgerRuntime({
  brokers,
  clientId,
  consumerGroupId,
  instanceId,
  canonicalTopic,
  persistedTopic,
  transactionTimeoutMs = 30_000,
  repository,
  kafka,
  onError = (error) => console.error("canonical-ledger Kafka runtime error", error),
} = {}) {
  if (!brokers?.length || !clientId || !consumerGroupId || !instanceId || !canonicalTopic || !persistedTopic) {
    throw new Error("Complete canonical-ledger Kafka configuration is required")
  }
  if (!repository || typeof repository.persist !== "function") {
    throw new Error("A canonical ledger repository is required")
  }
  const client = kafka ?? new Kafka({ brokers, clientId, logLevel: logLevel.WARN })
  const producer = client.producer({
    idempotent: true,
    maxInFlightRequests: 1,
    transactionalId: `${clientId}-${instanceId}`,
    transactionTimeout: transactionTimeoutMs,
    createPartitioner: Partitioners.DefaultPartitioner,
  })
  const consumer = client.consumer({ groupId: consumerGroupId, readUncommitted: false })
  let started = false
  let healthy = false
  let runPromise

  async function processMessage({ topic, partition, message }) {
    if (message.value === null) throw new Error("canonical topic must not contain tombstones")
    const event = validateCanonicalEvent(JSON.parse(message.value.toString("utf8")))
    const [keySourceId, keySourceEventId] = JSON.parse(message.key?.toString("utf8") ?? "null")
    if (keySourceId !== event.source_id || keySourceEventId !== event.source_event_id) {
      throw new Error("canonical Kafka key does not match CanonicalEvent identity")
    }
    const persisted = await repository.persist(event)
    const transaction = await producer.transaction()
    try {
      await transaction.send({
        topic: persistedTopic,
        messages: [{
          key: message.key,
          value: JSON.stringify({
            status: "canonical_persisted",
            canonical_event_id: event.canonical_event_id,
            persisted_at: persisted.persisted_at,
            canonical_event: event,
          }),
        }],
      })
      await transaction.sendOffsets({
        consumerGroupId,
        topics: [{
          topic,
          partitions: [{ partition, offset: String(BigInt(message.offset) + 1n) }],
        }],
      })
      await transaction.commit()
    } catch (error) {
      await transaction.abort().catch(() => {})
      throw error
    }
  }

  const markFailed = (error) => {
    healthy = false
    onError(error)
  }
  if (consumer.events?.CRASH && typeof consumer.on === "function") {
    consumer.on(consumer.events.CRASH, ({ payload }) => markFailed(payload?.error ?? new Error("canonical-ledger consumer crashed")))
  }

  return Object.freeze({
    isHealthy: () => healthy,
    async start() {
      if (started) return
      started = true
      try {
        await producer.connect()
        await consumer.connect()
        // A new ledger consumer group must be able to rebuild PostgreSQL from
        // the retained canonical topic; an existing group resumes its offset.
        await consumer.subscribe({ topic: canonicalTopic, fromBeginning: true })
        runPromise = consumer.run({
          autoCommit: false,
          partitionsConsumedConcurrently: 1,
          eachMessage: processMessage,
        })
        runPromise.catch(markFailed)
        healthy = true
      } catch (error) {
        healthy = false
        await consumer.stop().catch(() => {})
        await Promise.allSettled([consumer.disconnect(), producer.disconnect()])
        started = false
        throw error
      }
    },
    async stop() {
      healthy = false
      if (!started) return
      await consumer.stop().catch(() => {})
      await Promise.allSettled([consumer.disconnect(), producer.disconnect()])
      await runPromise?.catch(() => {})
      started = false
    },
  })
}
