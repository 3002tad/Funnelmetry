import test from "node:test"
import assert from "node:assert/strict"
import { createKafkaRuntime } from "../src/kafka-runtime.js"

const receipt = {
  status: "accepted",
  source_id: "shop",
  event_id: "evt-1",
  ingestion_id: "ing-1",
  received_at: "2026-08-27T00:00:00.000Z",
}

function fakeKafka(receipts = [receipt]) {
  let crashHandler
  let finishRun
  const calls = []
  const producer = {
    connect: async () => calls.push("producer.connect"),
    disconnect: async () => calls.push("producer.disconnect"),
    transaction: async () => { throw new Error("not used") },
  }
  const admin = {
    connect: async () => calls.push("admin.connect"),
    disconnect: async () => calls.push("admin.disconnect"),
    fetchTopicOffsets: async () => [{ partition: 0, high: String(receipts.length === 0 ? 0 : receipts.length + 2) }],
  }
  const consumer = {
    events: { CRASH: "crash" },
    on: (_event, handler) => { crashHandler = handler },
    connect: async () => calls.push("consumer.connect"),
    disconnect: async () => calls.push("consumer.disconnect"),
    subscribe: async () => calls.push("consumer.subscribe"),
    run: ({ eachBatch }) => {
      queueMicrotask(async () => {
        if (receipts.length > 0) {
          await eachBatch({
            batch: {
              partition: 0,
              highWatermark: String(receipts.length + 2),
              messages: receipts.map((value, index) => ({
                offset: String(index + 1),
                value: Buffer.from(JSON.stringify(value)),
              })),
            },
          })
        }
      })
      return new Promise((resolve) => { finishRun = resolve })
    },
    stop: async () => { calls.push("consumer.stop"); finishRun?.() },
  }
  return {
    calls,
    producer: () => producer,
    admin: () => admin,
    consumer: () => consumer,
    crash(error) { crashHandler({ payload: { error } }) },
  }
}

function runtimeOptions(kafka, onError = () => {}) {
  return {
    kafka,
    brokers: ["unused:9092"],
    clientId: "gateway",
    instanceId: "gateway-1",
    rawTopic: "raw",
    receiptTopic: "receipts",
    replayTimeoutMs: 1_000,
    onError,
  }
}

test("hydrates durable receipts before becoming ready", async () => {
  const kafka = fakeKafka()
  const runtime = createKafkaRuntime(runtimeOptions(kafka))
  assert.equal(runtime.isReady(), false)

  await runtime.start()
  assert.equal(runtime.isReady(), true)
  assert.equal(runtime.receiptIndex.get("shop", "evt-1").ingestion_id, "ing-1")
  assert.deepEqual(kafka.calls.slice(0, 4), [
    "producer.connect",
    "admin.connect",
    "consumer.connect",
    "consumer.subscribe",
  ])

  await runtime.stop()
  assert.equal(runtime.isReady(), false)
})

test("marks the gateway unready when the receipt consumer crashes", async () => {
  const errors = []
  const kafka = fakeKafka()
  const runtime = createKafkaRuntime(runtimeOptions(kafka, (error) => errors.push(error)))
  await runtime.start()

  kafka.crash(new Error("consumer failed"))
  assert.equal(runtime.isReady(), false)
  assert.match(errors[0].message, /consumer failed/)
  await runtime.stop()
})
