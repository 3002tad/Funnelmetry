import test from "node:test"
import assert from "node:assert/strict"
import { createKafkaFunnelRuntime } from "../src/kafka-runtime.js"
import { canonicalEvent } from "./fixtures.js"

function fakeKafka({ failCommit = false, onCommit = () => {} } = {}) {
  let eachMessage
  let finishRun
  const transactions = []
  const producer = {
    connect: async () => {}, disconnect: async () => {},
    transaction: async () => {
      const transaction = {
        sends: [], offsets: undefined, aborted: false,
        async send(value) { this.sends.push(value) },
        async sendOffsets(value) { this.offsets = value },
        async commit() { onCommit(); if (failCommit) throw new Error("transaction failed") },
        async abort() { this.aborted = true },
      }
      transactions.push(transaction)
      return transaction
    },
  }
  const consumer = {
    events: { CRASH: "crash" }, on: () => {}, connect: async () => {}, disconnect: async () => {}, subscribe: async () => {},
    run: ({ eachMessage: handler }) => { eachMessage = handler; return new Promise((resolve) => { finishRun = resolve }) },
    stop: async () => finishRun?.(),
  }
  return {
    transactions, producer: () => producer, consumer: () => consumer,
    deliver(event = canonicalEvent()) {
      return eachMessage({
        topic: "journey-resolved", partition: 1,
        message: { offset: "8", value: Buffer.from(JSON.stringify({
          status: "journey_resolved", canonical_event_id: event.canonical_event_id,
          journey_id: "journey_1", canonical_event: event,
        })) },
      })
    },
  }
}

function runtime(kafka, repository) {
  return createKafkaFunnelRuntime({
    kafka, repository, brokers: ["unused:9092"], clientId: "funnel", consumerGroupId: "funnel-v1",
    instanceId: "funnel-1", resolvedTopic: "journey-resolved", updatedTopic: "funnel-updated",
  })
}

test("emits funnel projection and offset only after PostgreSQL projection", async () => {
  let projected = false
  const kafka = fakeKafka({ onCommit: () => assert.equal(projected, true) })
  const worker = runtime(kafka, { project: async () => {
    projected = true
    return { status: "projected", canonical_event_id: "can_1", journey_id: "journey_1", updates: [] }
  } })
  await worker.start()
  await kafka.deliver()
  const envelope = JSON.parse(kafka.transactions[0].sends[0].messages[0].value)
  assert.equal(envelope.status, "funnel_updated")
  assert.equal(envelope.projection_status, "projected")
  assert.deepEqual(kafka.transactions[0].offsets.topics[0].partitions[0], { partition: 1, offset: "9" })
  await worker.stop()
})

test("does not open a Kafka transaction when PostgreSQL projection fails", async () => {
  const kafka = fakeKafka()
  const worker = runtime(kafka, { project: async () => { throw new Error("postgres unavailable") } })
  await worker.start()
  await assert.rejects(() => kafka.deliver(), /postgres unavailable/)
  assert.equal(kafka.transactions.length, 0)
  await worker.stop()
})

test("aborts funnel handoff when Kafka commit fails", async () => {
  const kafka = fakeKafka({ failCommit: true })
  const worker = runtime(kafka, { project: async () => ({ status: "projected", updates: [] }) })
  await worker.start()
  await assert.rejects(() => kafka.deliver(), /transaction failed/)
  assert.equal(kafka.transactions[0].aborted, true)
  await worker.stop()
})
