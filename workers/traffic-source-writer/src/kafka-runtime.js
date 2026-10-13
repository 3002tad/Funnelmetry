import { Kafka, logLevel } from 'kafkajs'
import { extractTrafficSourceObservation } from './observation.js'

export function createKafkaTrafficSourceRuntime({ brokers, clientId, consumerGroupId, rawTopic,
  repository, kafka, onError = error => console.error('traffic-source-writer runtime failed', error?.name ?? 'unknown') } = {}) {
  if (!brokers?.length || !clientId || !consumerGroupId || !rawTopic || !repository?.persist) {
    throw new Error('Complete traffic source Kafka configuration and repository are required')
  }
  const client = kafka ?? new Kafka({ brokers, clientId, logLevel: logLevel.WARN })
  const consumer = client.consumer({ groupId: consumerGroupId, readUncommitted: false })
  let started = false, healthy = false, runPromise

  async function processMessage({ topic, partition, message }) {
    if (message.value === null) throw new Error('traffic raw topic must not contain tombstones')
    const observation = extractTrafficSourceObservation({ key: message.key, value: message.value,
      rawRecordIdFallback: `${topic}:${partition}:${message.offset}` })
    if (observation) await repository.persist(observation)
    await consumer.commitOffsets([{ topic, partition, offset: String(BigInt(message.offset) + 1n) }])
  }

  const markFailed = error => { healthy = false; onError(error) }
  if (consumer.events?.CRASH && typeof consumer.on === 'function') {
    consumer.on(consumer.events.CRASH, ({ payload }) => markFailed(payload?.error ?? new Error('consumer crashed')))
  }
  return Object.freeze({
    isHealthy: () => healthy,
    async start() {
      if (started) return
      started = true
      try {
        await consumer.connect()
        // New group can only reconstruct the retained Raw Kafka prefix. The
        // table does not claim coverage before the topic retention floor.
        await consumer.subscribe({ topic: rawTopic, fromBeginning: true })
        runPromise = consumer.run({ autoCommit: false, partitionsConsumedConcurrently: 1,
          eachMessage: processMessage })
        runPromise.catch(markFailed)
        healthy = true
      } catch (error) {
        healthy = false
        await consumer.stop().catch(() => {})
        await consumer.disconnect().catch(() => {})
        started = false
        throw error
      }
    },
    async stop() {
      healthy = false
      if (!started) return
      await consumer.stop().catch(() => {})
      await consumer.disconnect().catch(() => {})
      await runPromise?.catch(() => {})
      started = false
    },
  })
}
