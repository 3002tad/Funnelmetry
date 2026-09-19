import { Kafka, logLevel, Partitioners } from "kafkajs"
import { createNormalizer } from "./normalizer.js"

function eventKey(outcome) {
  return JSON.stringify([outcome.source_id, outcome.source_event_id])
}

export function createKafkaNormalizerRuntime({
  brokers,
  clientId,
  consumerGroupId,
  instanceId,
  rawTopic,
  canonicalTopic,
  outcomeTopic,
  quarantineTopic,
  transactionTimeoutMs = 30_000,
  normalizer = createNormalizer(),
  kafka,
  onError = (error) => console.error("canonical-normalizer Kafka runtime error", error),
} = {}) {
  if (!brokers?.length || !clientId || !consumerGroupId || !instanceId || !rawTopic || !canonicalTopic || !outcomeTopic || !quarantineTopic) {
    throw new Error("Complete canonical-normalizer Kafka configuration is required")
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
    const result = normalizer.normalize({
      key: message.key,
      value: message.value,
      rawRecordIdFallback: `${topic}:${partition}:${message.offset}`,
    })
    const key = eventKey(result.outcome)
    const transaction = await producer.transaction()
    try {
      if (result.canonicalEvent) {
        await transaction.send({
          topic: canonicalTopic,
          messages: [{ key, value: JSON.stringify(result.canonicalEvent) }],
        })
      }
      if (result.quarantine) {
        await transaction.send({
          topic: quarantineTopic,
          messages: [{ key, value: JSON.stringify(result.quarantine) }],
        })
      }
      await transaction.send({
        topic: outcomeTopic,
        messages: [{ key, value: JSON.stringify(result.outcome) }],
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
    consumer.on(consumer.events.CRASH, ({ payload }) => markFailed(payload?.error ?? new Error("canonical consumer crashed")))
  }

  return Object.freeze({
    isHealthy: () => healthy,
    async start() {
      if (started) return
      started = true
      try {
        await producer.connect()
        await consumer.connect()
        // A new group must not skip records already durably accepted by Connector.
        // Existing groups still resume their committed offsets.
        await consumer.subscribe({ topic: rawTopic, fromBeginning: true })
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
