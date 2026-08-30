import { Kafka, logLevel, Partitioners } from "kafkajs"
import { validateCanonicalEvent } from "@funnelmetry/canonical-contract"

function validateJourneyEnvelope(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("journey resolved envelope must be an object")
  if (input.status !== "journey_resolved") throw new Error("journey resolved envelope status is invalid")
  if (typeof input.journey_id !== "string" || !input.journey_id) throw new Error("journey_id is required")
  const event = validateCanonicalEvent(input.canonical_event)
  if (input.canonical_event_id !== event.canonical_event_id) throw new Error("journey envelope identity does not match its event")
  return { event, journeyId: input.journey_id }
}

export function createKafkaFunnelRuntime({
  brokers, clientId, consumerGroupId, instanceId, resolvedTopic, updatedTopic,
  transactionTimeoutMs = 30_000, repository, kafka,
  onError = (error) => console.error("funnel-processor Kafka runtime error", error),
} = {}) {
  if (!brokers?.length || !clientId || !consumerGroupId || !instanceId || !resolvedTopic || !updatedTopic) {
    throw new Error("Complete funnel-processor Kafka configuration is required")
  }
  if (!repository || typeof repository.project !== "function") throw new Error("A funnel repository is required")
  const client = kafka ?? new Kafka({ brokers, clientId, logLevel: logLevel.WARN })
  const producer = client.producer({
    idempotent: true, maxInFlightRequests: 1,
    transactionalId: `${clientId}-${instanceId}`,
    transactionTimeout: transactionTimeoutMs,
    createPartitioner: Partitioners.DefaultPartitioner,
  })
  const consumer = client.consumer({ groupId: consumerGroupId, readUncommitted: false })
  let started = false
  let healthy = false
  let runPromise

  async function processMessage({ topic, partition, message }) {
    if (message.value === null) throw new Error("journey resolved topic must not contain tombstones")
    const { event, journeyId } = validateJourneyEnvelope(JSON.parse(message.value.toString("utf8")))
    const projection = await repository.project({ journeyId, canonicalEvent: event })
    const { status: projectionStatus, ...funnelProjection } = projection
    const transaction = await producer.transaction()
    try {
      await transaction.send({
        topic: updatedTopic,
        messages: [{
          key: Buffer.from(JSON.stringify([event.source_id, journeyId])),
          value: JSON.stringify({ status: "funnel_updated", projection_status: projectionStatus, ...funnelProjection }),
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

  const markFailed = (error) => { healthy = false; onError(error) }
  if (consumer.events?.CRASH && typeof consumer.on === "function") {
    consumer.on(consumer.events.CRASH, ({ payload }) => markFailed(payload?.error ?? new Error("funnel consumer crashed")))
  }
  return Object.freeze({
    isHealthy: () => healthy,
    async start() {
      if (started) return
      started = true
      try {
        await producer.connect()
        await consumer.connect()
        await consumer.subscribe({ topic: resolvedTopic, fromBeginning: true })
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
