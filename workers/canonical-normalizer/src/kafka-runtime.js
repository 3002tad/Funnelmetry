import { Kafka, logLevel, Partitioners } from "kafkajs"
import { createHash } from "node:crypto"
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
  transactionBatchSize = 64,
  normalizer = createNormalizer(),
  kafka,
  onError = (error) => console.error("canonical-normalizer Kafka runtime error", error),
} = {}) {
  if (!brokers?.length || !clientId || !consumerGroupId || !instanceId || !rawTopic || !canonicalTopic || !outcomeTopic || !quarantineTopic) {
    throw new Error("Complete canonical-normalizer Kafka configuration is required")
  }
  if (!Number.isSafeInteger(transactionBatchSize) || transactionBatchSize < 1 || transactionBatchSize > 256) {
    throw new Error("transactionBatchSize must be between 1 and 256")
  }
  const client = kafka ?? new Kafka({ brokers, clientId, logLevel: logLevel.WARN })
  // A stable producer ID per input partition fences a worker that loses ownership.
  // Container IDs are unique but cannot fence a previous owner after rebalance.
  const producers = new Map()
  const producerKey = (topic, partition) => `${topic}:${partition}`
  async function producerFor(topic, partition) {
    const key = producerKey(topic, partition)
    if (producers.has(key)) return producers.get(key)
    const id = createHash("sha256").update(JSON.stringify([consumerGroupId, topic, partition])).digest("hex")
    const producer = client.producer({
      idempotent: true,
      maxInFlightRequests: 1,
      transactionalId: `funnelmetry-normalizer-${id}`,
      transactionTimeout: transactionTimeoutMs,
      createPartitioner: Partitioners.DefaultPartitioner,
    })
    await producer.connect()
    producers.set(key, producer)
    return producer
  }
  async function discardProducer(topic, partition) {
    const key = producerKey(topic, partition)
    const producer = producers.get(key)
    producers.delete(key)
    await producer?.disconnect().catch(() => {})
  }
  async function disconnectProducers() {
    await Promise.allSettled([...producers.values()].map((producer) => producer.disconnect()))
    producers.clear()
  }
  const consumer = client.consumer({ groupId: consumerGroupId, readUncommitted: false })
  let started = false
  let healthy = false
  let runPromise

  async function processChunk({ topic, partition, messages, heartbeat, isRunning, isStale, resolveOffset }) {
    const outputs = messages.map((message) => normalizer.normalize({
      key: message.key,
      value: message.value,
      rawRecordIdFallback: `${topic}:${partition}:${message.offset}`,
    }))
    const producer = await producerFor(topic, partition)
    let transaction
    try {
      transaction = await producer.transaction()
    } catch (error) {
      await discardProducer(topic, partition)
      throw error
    }
    try {
      if (!isRunning() || isStale()) {
        await transaction.abort()
        await discardProducer(topic, partition)
        return false
      }
      const canonicalMessages = []
      const quarantineMessages = []
      const outcomeMessages = []
      for (const result of outputs) {
        const key = eventKey(result.outcome)
        if (result.canonicalEvent) canonicalMessages.push({ key, value: JSON.stringify(result.canonicalEvent) })
        if (result.quarantine) quarantineMessages.push({ key, value: JSON.stringify(result.quarantine) })
        outcomeMessages.push({ key, value: JSON.stringify(result.outcome) })
      }
      if (canonicalMessages.length) {
        await transaction.send({
          topic: canonicalTopic,
          messages: canonicalMessages,
        })
      }
      if (quarantineMessages.length) {
        await transaction.send({
          topic: quarantineTopic,
          messages: quarantineMessages,
        })
      }
      await transaction.send({
        topic: outcomeTopic,
        messages: outcomeMessages,
      })
      await heartbeat()
      if (!isRunning() || isStale()) {
        await transaction.abort()
        await discardProducer(topic, partition)
        return false
      }
      await transaction.sendOffsets({
        consumerGroupId,
        topics: [{
          topic,
          partitions: [{ partition, offset: String(BigInt(messages.at(-1).offset) + 1n) }],
        }],
      })
      await transaction.commit()
      resolveOffset(messages.at(-1).offset)
      return true
    } catch (error) {
      await transaction.abort().catch(() => {})
      // A producer may have been fenced by a new owner. Never reuse it after an error.
      await discardProducer(topic, partition)
      throw error
    }
  }

  async function processBatch({ batch, heartbeat, isRunning, isStale, resolveOffset }) {
    for (let index = 0; index < batch.messages.length; index += transactionBatchSize) {
      if (!isRunning() || isStale()) break
      const committed = await processChunk({
        topic: batch.topic,
        partition: batch.partition,
        messages: batch.messages.slice(index, index + transactionBatchSize),
        heartbeat,
        isRunning,
        isStale,
        resolveOffset,
      })
      if (!committed) break
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
        await consumer.connect()
        // A new group must not skip records already durably accepted by Connector.
        // Existing groups still resume their committed offsets.
        await consumer.subscribe({ topic: rawTopic, fromBeginning: true })
        runPromise = consumer.run({
          autoCommit: false,
          eachBatchAutoResolve: false,
          partitionsConsumedConcurrently: 1,
          eachBatch: processBatch,
        })
        runPromise.catch(markFailed)
        healthy = true
      } catch (error) {
        healthy = false
        await consumer.stop().catch(() => {})
        await Promise.allSettled([consumer.disconnect(), disconnectProducers()])
        started = false
        throw error
      }
    },
    async stop() {
      healthy = false
      if (!started) return
      await consumer.stop().catch(() => {})
      await Promise.allSettled([consumer.disconnect(), disconnectProducers()])
      await runPromise?.catch(() => {})
      started = false
    },
  })
}
