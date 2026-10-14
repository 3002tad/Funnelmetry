import test from "node:test"
import assert from "node:assert/strict"
import { createKafkaNormalizerRuntime } from "../src/kafka-runtime.js"

function normalizedResult() {
  return {
    status: "normalized",
    canonicalEvent: { canonical_event_id: "can_1" },
    outcome: {
      source_id: "reference-shop",
      source_event_id: "source:evt-1",
      status: "normalized",
      canonical_event_id: "can_1",
    },
  }
}

function fakeKafka({ failCommit = false, failCommitAt = -1 } = {}) {
  const calls = []
  let eachBatch
  let finishRun
  let crashHandler
  const transactions = []
  const producerConfigs = []
  const producer = (config) => {
    producerConfigs.push(config)
    return {
    connect: async () => calls.push("producer.connect"),
    disconnect: async () => calls.push("producer.disconnect"),
    transaction: async () => {
      const transaction = {
        sends: [],
        offsets: undefined,
        committed: false,
        aborted: false,
        async send(value) { this.sends.push(value) },
        async sendOffsets(value) { this.offsets = value },
        async commit() {
          if (failCommit || transactions.indexOf(this) === failCommitAt) throw new Error("commit failed")
          this.committed = true
        },
        async abort() { this.aborted = true },
      }
      transactions.push(transaction)
      return transaction
    },
    }
  }
  const consumer = {
    events: { CRASH: "crash" },
    on: (_event, handler) => { crashHandler = handler },
    connect: async () => calls.push("consumer.connect"),
    disconnect: async () => calls.push("consumer.disconnect"),
    subscribe: async (options) => { assert.equal(options.fromBeginning, true); calls.push("consumer.subscribe") },
    run: (options) => {
      eachBatch = options.eachBatch
      calls.push(`consumer.run:autoCommit=${options.autoCommit}:autoResolve=${options.eachBatchAutoResolve}`)
      return new Promise((resolve) => { finishRun = resolve })
    },
    stop: async () => { calls.push("consumer.stop"); finishRun?.() },
  }
  return {
    calls,
    transactions,
    producerConfigs,
    producer,
    consumer: () => consumer,
    async deliver(messages = [{ offset: "7", key: Buffer.from("key"), value: Buffer.from("value") }], options = {}) {
      const resolved = []
      await eachBatch({
        batch: { topic: "raw", partition: options.partition ?? 2, messages },
        heartbeat: async () => calls.push("heartbeat"),
        isRunning: () => options.isRunning?.() ?? options.running !== false,
        isStale: () => options.isStale?.() ?? options.stale === true,
        resolveOffset: (offset) => resolved.push(offset),
      })
      return resolved
    },
    crash(error) { crashHandler({ payload: { error } }) },
  }
}

function runtime(kafka, normalizer, onError = () => {}, transactionBatchSize = 64, clientId = "normalizer") {
  return createKafkaNormalizerRuntime({
    kafka,
    normalizer,
    brokers: ["unused:9092"],
    clientId,
    consumerGroupId: "normalizer-v1",
    instanceId: "normalizer-1",
    rawTopic: "raw",
    canonicalTopic: "canonical",
    outcomeTopic: "outcomes",
    quarantineTopic: "quarantine",
    transactionBatchSize,
    onError,
  })
}

test("atomically writes canonical event, outcome and consumed offset", async () => {
  const kafka = fakeKafka()
  const worker = runtime(kafka, { normalize: normalizedResult })
  await worker.start()
  const resolved = await kafka.deliver()

  const transaction = kafka.transactions[0]
  assert.deepEqual(transaction.sends.map((send) => send.topic), ["canonical", "outcomes"])
  assert.deepEqual(transaction.offsets, {
    consumerGroupId: "normalizer-v1",
    topics: [{ topic: "raw", partitions: [{ partition: 2, offset: "8" }] }],
  })
  assert.equal(transaction.committed, true)
  assert.deepEqual(resolved, ["7"])
  assert.equal(kafka.calls.includes("consumer.run:autoCommit=false:autoResolve=false"), true)
  assert.equal(worker.isHealthy(), true)
  await worker.stop()
})

test("atomically writes quarantine and terminal outcome for unsupported semantics", async () => {
  const kafka = fakeKafka()
  const worker = runtime(kafka, {
    normalize: () => ({
      status: "unsupported",
      quarantine: { reason_code: "mapping_not_found" },
      outcome: { source_id: "reference-shop", source_event_id: "source:evt-1", status: "unsupported" },
    }),
  })
  await worker.start()
  await kafka.deliver()

  assert.deepEqual(kafka.transactions[0].sends.map((send) => send.topic), ["quarantine", "outcomes"])
  assert.equal(kafka.transactions[0].committed, true)
  await worker.stop()
})

test("aborts output and does not commit the raw offset when Kafka commit fails", async () => {
  const kafka = fakeKafka({ failCommit: true })
  const worker = runtime(kafka, { normalize: normalizedResult })
  await worker.start()

  await assert.rejects(() => kafka.deliver(), /commit failed/)
  assert.equal(kafka.transactions[0].aborted, true)
  assert.equal(kafka.transactions[0].committed, false)
  await worker.stop()
})

test("bounds a transaction to one chunk and commits only the last offset in each chunk", async () => {
  const kafka = fakeKafka()
  const worker = runtime(kafka, { normalize: normalizedResult }, () => {}, 2)
  await worker.start()
  const resolved = await kafka.deliver(["0", "1", "2", "3", "4"].map((offset) => ({ offset })))

  assert.equal(kafka.transactions.length, 3)
  assert.deepEqual(kafka.transactions.map((tx) => tx.sends.at(-1).messages.length), [2, 2, 1])
  assert.deepEqual(kafka.transactions.map((tx) => tx.offsets.topics[0].partitions[0].offset), ["2", "4", "5"])
  assert.deepEqual(resolved, ["1", "3", "4"])
  assert.equal(kafka.producerConfigs.length, 1)
  await worker.stop()
})

test("failed second chunk leaves its offset uncommitted and discards the producer", async () => {
  const kafka = fakeKafka({ failCommitAt: 1 })
  const worker = runtime(kafka, { normalize: normalizedResult }, () => {}, 2)
  await worker.start()
  await assert.rejects(() => kafka.deliver(["0", "1", "2", "3"].map((offset) => ({ offset }))), /commit failed/)
  assert.equal(kafka.transactions[0].committed, true)
  assert.equal(kafka.transactions[1].committed, false)
  assert.equal(kafka.transactions[1].aborted, true)
  assert.equal(kafka.calls.includes("producer.disconnect"), true)
  await worker.stop()
})

test("rebalance after output send aborts without an offset commit", async () => {
  const kafka = fakeKafka()
  const worker = runtime(kafka, { normalize: normalizedResult })
  let stale = false
  await worker.start()
  const resolved = await kafka.deliver([{ offset: "7" }], { isStale: () => stale = stale || kafka.calls.includes("heartbeat") })
  assert.deepEqual(resolved, [])
  assert.equal(kafka.transactions[0].aborted, true)
  assert.equal(kafka.transactions[0].committed, false)
  assert.equal(kafka.transactions[0].offsets, undefined)
  await worker.stop()
})

test("stale batch does not produce or commit offsets", async () => {
  const kafka = fakeKafka()
  const worker = runtime(kafka, { normalize: normalizedResult })
  await worker.start()
  assert.deepEqual(await kafka.deliver([{ offset: "7" }], { stale: true }), [])
  assert.equal(kafka.transactions.length, 0)
  await worker.stop()
})

test("transactional ID is stable by group and partition across worker instances", async () => {
  const first = fakeKafka()
  const second = fakeKafka()
  const firstWorker = runtime(first, { normalize: normalizedResult })
  const secondWorker = runtime(second, { normalize: normalizedResult }, () => {}, 64, "new-client-label")
  await firstWorker.start()
  await secondWorker.start()
  await first.deliver([{ offset: "0" }])
  await second.deliver([{ offset: "1" }])
  assert.equal(first.producerConfigs[0].transactionalId, second.producerConfigs[0].transactionalId)
  await second.deliver([{ offset: "0" }], { partition: 1 })
  assert.notEqual(first.producerConfigs[0].transactionalId, second.producerConfigs[1].transactionalId)
  await firstWorker.stop()
  await secondWorker.stop()
})

test("marks runtime unhealthy when its raw consumer crashes", async () => {
  const errors = []
  const kafka = fakeKafka()
  const worker = runtime(kafka, { normalize: normalizedResult }, (error) => errors.push(error))
  await worker.start()
  kafka.crash(new Error("consumer failed"))

  assert.equal(worker.isHealthy(), false)
  assert.match(errors[0].message, /consumer failed/)
  await worker.stop()
})
