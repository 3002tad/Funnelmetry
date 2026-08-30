import { Kafka, logLevel, Partitioners } from "kafkajs"
import { validateCanonicalEvent } from "@funnelmetry/canonical-contract"

function validatePersistedEnvelope(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("canonical persisted envelope must be an object")
  if (input.status !== "canonical_persisted") throw new Error("canonical persisted envelope status is invalid")
  if (typeof input.persisted_at !== "string" || Number.isNaN(Date.parse(input.persisted_at))) {
    throw new Error("canonical persisted_at must be an ISO-8601 timestamp")
  }
  const event = validateCanonicalEvent(input.canonical_event)
  if (input.canonical_event_id !== event.canonical_event_id) {
    throw new Error("canonical persisted identity does not match its event")
  }
  return { event, persistedAt: input.persisted_at }
}

export function createKafkaJourneyRuntime({
  brokers,
  clientId,
  consumerGroupId,
  instanceId,
  persistedTopic,
  resolvedTopic,
  transactionTimeoutMs = 30_000,
  repository,
  kafka,
  onError = (error) => console.error("journey-processor Kafka runtime error", error),
} = {}) {
  if (!brokers?.length || !clientId || !consumerGroupId || !instanceId || !persistedTopic || !resolvedTopic) {
    throw new Error("Complete journey-processor Kafka configuration is required")
  }
  if (!repository || typeof repository.resolve !== "function") throw new Error("A journey repository is required")
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
    if (message.value === null) throw new Error("canonical persisted topic must not contain tombstones")
    const { event, persistedAt } = validatePersistedEnvelope(JSON.parse(message.value.toString("utf8")))
    const [keySourceId, keySourceEventId] = JSON.parse(message.key?.toString("utf8") ?? "null")
    if (keySourceId !== event.source_id || keySourceEventId !== event.source_event_id) {
      throw new Error("persisted Kafka key does not match CanonicalEvent identity")
    }
    const resolution = await repository.resolve(event)
    const { status: resolutionStatus, ...journeyResolution } = resolution
    const transaction = await producer.transaction()
    try {
      await transaction.send({
        topic: resolvedTopic,
        messages: [{
          key: message.key,
          value: JSON.stringify({
            status: "journey_resolved",
            resolution_status: resolutionStatus,
            canonical_persisted_at: persistedAt,
            ...journeyResolution,
            canonical_event: event,
          }),
        }],
      })
      await transaction.sendOffsets({
        consumerGroupId,
        topics: [{ topic, partitions: [{ partition, offset: String(BigInt(message.offset) + 1n) }] }],
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
    consumer.on(consumer.events.CRASH, ({ payload }) => markFailed(payload?.error ?? new Error("journey consumer crashed")))
  }

  return Object.freeze({
    isHealthy: () => healthy,
    async start() {
      if (started) return
      started = true
      try {
        await producer.connect()
        await consumer.connect()
        await consumer.subscribe({ topic: persistedTopic, fromBeginning: true })
        runPromise = consumer.run({ autoCommit: false, partitionsConsumedConcurrently: 1, eachMessage: processMessage })
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
