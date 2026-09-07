import { randomUUID } from "node:crypto"
import { Kafka, logLevel, Partitioners } from "kafkajs"
import { validateIngressReceipt } from "@3002tad/funnelmetry-input-contract"
import { createKafkaDurableIngress, createReceiptIndex } from "./kafka-durable-ingress.js"

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
  transactionTimeoutMs = 30_000,
  replayTimeoutMs = 60_000,
  kafka,
  bootId = randomUUID(),
  onError = (error) => console.error("input-gateway Kafka runtime error", error),
} = {}) {
  if (!brokers?.length || !clientId || !instanceId || !rawTopic || !receiptTopic) {
    throw new Error("Complete Kafka runtime configuration is required")
  }
  const client = kafka ?? new Kafka({ brokers, clientId, logLevel: logLevel.WARN })
  const producer = client.producer({
    idempotent: true,
    maxInFlightRequests: 1,
    transactionalId: `${clientId}-${instanceId}`,
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
  let runPromise

  const markFailed = (error) => {
    receiptIndex.markNotReady()
    onError(error)
  }
  if (consumer.events?.CRASH && typeof consumer.on === "function") {
    consumer.on(consumer.events.CRASH, ({ payload }) => markFailed(payload?.error ?? new Error("receipt consumer crashed")))
  }

  return Object.freeze({
    durableIngress,
    receiptIndex,
    isReady: () => receiptIndex.isReady(),
    async start() {
      if (started) return
      started = true
      try {
        await producer.connect()
        await admin.connect()
        const targets = offsetsByPartition(await admin.fetchTopicOffsets(receiptTopic))
        await consumer.connect()
        await consumer.subscribe({ topic: receiptTopic, fromBeginning: true })
        const tracker = replayTracker(targets)
        runPromise = consumer.run({
          eachBatch: async ({ batch }) => {
            for (const message of batch.messages) {
              if (message.value !== null) {
                const receipt = validateIngressReceipt(JSON.parse(message.value.toString("utf8")))
                if (receiptCoordinator) await receiptCoordinator.confirmReceipt(receipt)
                receiptIndex.set(receipt)
              }
            }
            // Kafka high watermarks include transaction control records, which are
            // intentionally not exposed through eachMessage/message offsets.
            tracker.observePosition(batch.partition, batch.highWatermark)
          },
        })
        runPromise.catch(markFailed)
        await withTimeout(tracker.replayed, replayTimeoutMs, "receipt topic replay timed out")
        receiptIndex.markReady()
      } catch (error) {
        receiptIndex.markNotReady()
        await consumer.stop().catch(() => {})
        await Promise.allSettled([consumer.disconnect(), admin.disconnect(), producer.disconnect()])
        started = false
        throw error
      }
    },
    async stop() {
      receiptIndex.markNotReady()
      if (!started) return
      await consumer.stop().catch(() => {})
      await Promise.allSettled([consumer.disconnect(), admin.disconnect(), producer.disconnect()])
      await runPromise?.catch(() => {})
      started = false
    },
  })
}
