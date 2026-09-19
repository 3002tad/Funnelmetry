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

function fakeKafka({ failCommit = false } = {}) {
  const calls = []
  let eachMessage
  let finishRun
  let crashHandler
  const transactions = []
  const producer = {
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
          if (failCommit) throw new Error("commit failed")
          this.committed = true
        },
        async abort() { this.aborted = true },
      }
      transactions.push(transaction)
      return transaction
    },
  }
  const consumer = {
    events: { CRASH: "crash" },
    on: (_event, handler) => { crashHandler = handler },
    connect: async () => calls.push("consumer.connect"),
    disconnect: async () => calls.push("consumer.disconnect"),
    subscribe: async (options) => { assert.equal(options.fromBeginning, true); calls.push("consumer.subscribe") },
    run: (options) => {
      eachMessage = options.eachMessage
      calls.push(`consumer.run:autoCommit=${options.autoCommit}`)
      return new Promise((resolve) => { finishRun = resolve })
    },
    stop: async () => { calls.push("consumer.stop"); finishRun?.() },
  }
  return {
    calls,
    transactions,
    producer: () => producer,
    consumer: () => consumer,
    async deliver(message = { offset: "7", key: Buffer.from("key"), value: Buffer.from("value") }) {
      return eachMessage({ topic: "raw", partition: 2, message })
    },
    crash(error) { crashHandler({ payload: { error } }) },
  }
}

function runtime(kafka, normalizer, onError = () => {}) {
  return createKafkaNormalizerRuntime({
    kafka,
    normalizer,
    brokers: ["unused:9092"],
    clientId: "normalizer",
    consumerGroupId: "normalizer-v1",
    instanceId: "normalizer-1",
    rawTopic: "raw",
    canonicalTopic: "canonical",
    outcomeTopic: "outcomes",
    quarantineTopic: "quarantine",
    onError,
  })
}

test("atomically writes canonical event, outcome and consumed offset", async () => {
  const kafka = fakeKafka()
  const worker = runtime(kafka, { normalize: normalizedResult })
  await worker.start()
  await kafka.deliver()

  const transaction = kafka.transactions[0]
  assert.deepEqual(transaction.sends.map((send) => send.topic), ["canonical", "outcomes"])
  assert.deepEqual(transaction.offsets, {
    consumerGroupId: "normalizer-v1",
    topics: [{ topic: "raw", partitions: [{ partition: 2, offset: "8" }] }],
  })
  assert.equal(transaction.committed, true)
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
