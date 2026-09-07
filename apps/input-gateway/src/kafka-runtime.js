import { randomUUID } from "node:crypto"
import kafkaJs from "kafkajs"
import { validateIngressReceipt } from "@funnelmetry/input-contract"
import { createKafkaDurableIngress, createReceiptIndex } from "./kafka-durable-ingress.js"

const { Kafka, logLevel, Partitioners, ConfigResourceTypes } = kafkaJs

function offsetsByPartition(offsets) {
  return new Map(offsets.map(({ partition, high, offset }) => [partition, BigInt(high ?? offset)]))
}

function replayTracker(targets) {
  let resolveReplay
  const replayed = new Promise((resolve) => { resolveReplay = resolve })
  const reached = new Set([...targets].filter(([, high]) => high === 0n).map(([partition]) => partition))

  function check() {
    if (reached.size === targets.size) resolveReplay()
  }
  check()
  return {
    replayed,
    observePosition(partition, nextOffset) {
      const target = targets.get(partition)
      if (target !== undefined && BigInt(nextOffset) >= target) reached.add(partition)
      check()
    },
  }
}

function withTimeout(promise, timeoutMs, message) {
  let timer
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs)
      timer.unref?.()
    }),
  ]).finally(() => clearTimeout(timer))
}

export function createKafkaRuntime({
  brokers,
  clientId,
  instanceId,
  rawTopic,
  receiptTopic,
  receiptCoordinator,
  recoverFencedClaims = false,
  transactionTimeoutMs = 30_000,
  replayTimeoutMs = 60_000,
  kafka,
  bootId = randomUUID(),
  onError = (error) => console.error("input-gateway Kafka runtime error", error),
} = {}) {
  if (!brokers?.length || !clientId || !instanceId || !rawTopic || !receiptTopic) {
    throw new Error("Complete Kafka runtime configuration is required")
  }
  if (recoverFencedClaims && !receiptCoordinator) throw new Error('fenced claim recovery requires PostgreSQL coordination')
  const client = kafka ?? new Kafka({ brokers, clientId, logLevel: logLevel.WARN })
  const transactionalId = `${clientId}-${instanceId}`
  const producer = client.producer({
    idempotent: true,
    maxInFlightRequests: 1,
    transactionalId,
    transactionTimeout: transactionTimeoutMs,
    createPartitioner: Partitioners.DefaultPartitioner,
  })
  const consumer = client.consumer({
    groupId: `${clientId}-receipt-replay-${instanceId}-${bootId}`,
    readUncommitted: false,
  })
  const admin = client.admin()
  const receiptIndex = createReceiptIndex()
  const durableIngress = createKafkaDurableIngress({
    producer, receiptIndex, receiptCoordinator, rawTopic, receiptTopic,
  })
  let started = false
  let startAttempted = false
  let runPromise
  let replayProgress
  let consumerFailure

  const markFailed = (error) => {
    consumerFailure = error
    receiptIndex.markNotReady()
    onError(error)
  }
  if (consumer.events?.CRASH && typeof consumer.on === "function") {
    consumer.on(consumer.events.CRASH, ({ payload }) => markFailed(payload?.error ?? new Error("receipt consumer crashed")))
  }
  if (consumer.events?.END_BATCH_PROCESS && typeof consumer.on === "function") {
    consumer.on(consumer.events.END_BATCH_PROCESS, ({ payload }) => {
      // KafkaJS also emits this for batches containing only filtered control or
      // aborted records, for which eachBatch is not called.
      if (payload.topic === receiptTopic && payload.lastOffset != null) {
        replayProgress?.observePosition(payload.partition, BigInt(payload.lastOffset) + 1n)
      }
    })
  }

  return Object.freeze({
    durableIngress,
    receiptIndex,
    isReady: () => receiptIndex.isReady(),
    async start() {
      if (started) return
      if (startAttempted) throw new Error('create a new Kafka runtime to restart with a fresh producer generation')
      startAttempted = true
      started = true
      consumerFailure = undefined
      try {
        if (receiptCoordinator) {
          await receiptCoordinator.prepareProducerGeneration({ transactionalId, generationId: bootId })
        }
        await producer.connect()
        // KafkaJS connect() initializes only its non-transactional producer ID.
        // Force transactional initialization before claims/traffic and before the
        // replay snapshot, fencing older initialized producers with the same ID.
        const initialization = await producer.transaction()
        await initialization.abort()
        let kafkaScope
        await admin.connect()
        if (recoverFencedClaims) {
          const cluster = await admin.describeCluster()
          const config = await admin.describeConfigs({ resources: [{
            type: ConfigResourceTypes.TOPIC, name: receiptTopic, configNames: ['cleanup.policy'],
          }] })
          const resource = config.resources.find(row => row.resourceName === receiptTopic)
          const policy = resource?.configEntries.find(row => row.configName === 'cleanup.policy')?.configValue
          if (policy?.trim() !== 'compact') throw new Error('recovery requires a compact-only retained receipt topic')
          if (!cluster.clusterId) throw new Error('Kafka cluster identity is required for recovery')
          kafkaScope = { clusterId: cluster.clusterId, rawTopic, receiptTopic }
        }
        if (receiptCoordinator) {
          receiptCoordinator.bindProducerIdentity({ transactionalId, generationId: bootId, ...(kafkaScope && { kafkaScope }) })
        }
        const targets = offsetsByPartition(await admin.fetchTopicOffsets(receiptTopic))
        await consumer.connect()
        await consumer.subscribe({ topic: receiptTopic, fromBeginning: true })
        const tracker = replayTracker(targets)
        replayProgress = tracker
        runPromise = consumer.run({
          eachBatch: async ({ batch }) => {
            for (const message of batch.messages) {
              if (message.value !== null) {
                const receipt = validateIngressReceipt(JSON.parse(message.value.toString("utf8")))
                if (receiptCoordinator) await receiptCoordinator.confirmReceipt(receipt)
                receiptIndex.set(receipt)
              }
            }
            // A broker high watermark is not this consumer's processed position.
            // lastOffset includes control records in this fetched batch only.
            tracker.observePosition(batch.partition, BigInt(batch.lastOffset()) + 1n)
          },
        })
        runPromise.catch(markFailed)
        await withTimeout(tracker.replayed, replayTimeoutMs, "receipt topic replay timed out")
        if (consumerFailure) throw consumerFailure
        if (recoverFencedClaims) {
          await receiptCoordinator.recoverFencedClaims({
            replayOffsets: [...targets].map(([partition, offset]) => ({ partition, offset: offset.toString() })),
          })
        }
        if (receiptCoordinator) await receiptCoordinator.readyProducerGeneration()
        if (consumerFailure) throw consumerFailure
        receiptIndex.markReady()
      } catch (error) {
        receiptIndex.markNotReady()
        replayProgress = undefined
        await consumer.stop().catch(() => {})
        await Promise.allSettled([consumer.disconnect(), admin.disconnect(), producer.disconnect()])
        started = false
        throw error
      }
    },
    async stop() {
      receiptIndex.markNotReady()
      replayProgress = undefined
      if (!started) return
      await consumer.stop().catch(() => {})
      await Promise.allSettled([consumer.disconnect(), admin.disconnect(), producer.disconnect()])
      await runPromise?.catch(() => {})
      started = false
    },
  })
}
