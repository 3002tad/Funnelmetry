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
  let producerReady = false
  let groupJoined = false
  let processingFailed = false
  let terminalFailure = false

  const refreshHealth = () => {
    healthy = started && producerReady && groupJoined && !processingFailed && !terminalFailure
  }

  async function persistMessage({ topic, partition, message }) {
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
            canonical_event: persisted.canonical_event,
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

  async function processMessage(sample) {
    try {
      await persistMessage(sample)
      // A rejoin alone cannot clear a failed database/transaction handoff.
      processingFailed = false
      refreshHealth()
    } catch (error) {
      processingFailed = true
      healthy = false
      throw error
    }
  }

  const markFailed = (error) => {
    healthy = false
    onError(error)
  }
  if (consumer.events?.CRASH && typeof consumer.on === "function") {
    consumer.on(consumer.events.CRASH, ({ payload }) => {
      groupJoined = false
      if (payload?.restart !== true) terminalFailure = true
      markFailed(payload?.error ?? new Error("canonical-ledger consumer crashed"))
    })
  }
  const listen = (client, event, handler) => {
    if (event && typeof client.on === "function") client.on(event, handler)
  }
  listen(consumer, consumer.events?.GROUP_JOIN, ({ payload }) => {
    if (!started || payload?.groupId !== consumerGroupId) return
    groupJoined = true
    refreshHealth()
  })
  for (const event of [consumer.events?.REBALANCING, consumer.events?.STOP, consumer.events?.DISCONNECT]) {
    listen(consumer, event, () => { groupJoined = false; healthy = false })
  }
  listen(producer, producer.events?.DISCONNECT, () => { producerReady = false; healthy = false })
  listen(producer, producer.events?.CONNECT, () => {
    if (!started) return
    producerReady = true
    refreshHealth()
  })

  return Object.freeze({
    isHealthy: () => healthy,
    async start() {
      if (started) return
      started = true
      healthy = false
      groupJoined = false
      producerReady = false
      processingFailed = false
      terminalFailure = false
      try {
        await producer.connect()
        producerReady = true
        await consumer.connect()
        // A new ledger consumer group must be able to rebuild PostgreSQL from
        // the retained canonical topic; an existing group resumes its offset.
        await consumer.subscribe({ topic: canonicalTopic, fromBeginning: true })
        runPromise = consumer.run({
          autoCommit: false,
          partitionsConsumedConcurrently: 1,
          eachMessage: processMessage,
        })
        runPromise.catch(error => { terminalFailure = true; markFailed(error) })
        refreshHealth()
      } catch (error) {
        healthy = false
        started = false
        producerReady = false
        groupJoined = false
        await consumer.stop().catch(() => {})
        await Promise.allSettled([consumer.disconnect(), producer.disconnect()])
        started = false
        throw error
      }
    },
    async stop() {
      healthy = false
      if (!started) return
      // Ignore late GROUP_JOIN / producer CONNECT callbacks during shutdown.
      started = false
      groupJoined = false
      producerReady = false
      await consumer.stop().catch(() => {})
      await Promise.allSettled([consumer.disconnect(), producer.disconnect()])
      await runPromise?.catch(() => {})
      started = false
    },
  })
}
