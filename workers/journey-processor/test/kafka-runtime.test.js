import test from "node:test"
import assert from "node:assert/strict"
import { createKafkaJourneyRuntime } from "../src/kafka-runtime.js"
import { canonicalEvent } from "./fixtures.js"

function fakeKafka({ failCommit = false, onCommit = () => {} } = {}) {
  let eachMessage
  let finishRun
  let crashHandler
  const transactions = []
  const producer = {
    connect: async () => {},
    disconnect: async () => {},
    transaction: async () => {
      const transaction = {
        sends: [], offsets: undefined, committed: false, aborted: false,
        async send(value) { this.sends.push(value) },
        async sendOffsets(value) { this.offsets = value },
        async commit() {
          onCommit()
          if (failCommit) throw new Error("transaction failed")
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
    connect: async () => {}, disconnect: async () => {}, subscribe: async () => {},
    run: ({ eachMessage: handler }) => {
      eachMessage = handler
      return new Promise((resolve) => { finishRun = resolve })
    },
    stop: async () => finishRun?.(),
  }
  return {
    transactions,
    producer: () => producer,
    consumer: () => consumer,
    deliver(event = canonicalEvent()) {
      return eachMessage({
        topic: "canonical-persisted",
        partition: 0,
        message: {
          offset: "4",
          key: Buffer.from(JSON.stringify([event.source_id, event.source_event_id])),
          value: Buffer.from(JSON.stringify({
            status: "canonical_persisted",
            canonical_event_id: event.canonical_event_id,
            persisted_at: "2026-08-29T01:00:03.000Z",
            canonical_event: event,
          })),
        },
      })
    },
    crash(error) { crashHandler({ payload: { error } }) },
  }
}

function runtime(kafka, repository, onError = () => {}) {
  return createKafkaJourneyRuntime({
    kafka, repository, onError,
    brokers: ["unused:9092"], clientId: "journey", consumerGroupId: "journey-v1",
    instanceId: "journey-1", persistedTopic: "canonical-persisted", resolvedTopic: "journey-resolved",
  })
}

const resolution = {
  status: "linked",
  canonical_event_id: "can_1",
  journey_id: "journey_1",
  link_method: "NEW_JOURNEY",
  link_confidence: "ISOLATED",
  linked_at: "2026-08-29T01:00:04.000Z",
}

test("emits journey resolution and offset only after PostgreSQL projection", async () => {
  let projected = false
  const kafka = fakeKafka({ onCommit: () => assert.equal(projected, true) })
  const worker = runtime(kafka, { resolve: async () => { projected = true; return resolution } })
  await worker.start()
  await kafka.deliver()

  assert.equal(kafka.transactions[0].sends[0].topic, "journey-resolved")
  const envelope = JSON.parse(kafka.transactions[0].sends[0].messages[0].value)
  assert.equal(envelope.status, "journey_resolved")
  assert.equal(envelope.resolution_status, "linked")
  assert.equal(envelope.journey_id, "journey_1")
  assert.deepEqual(kafka.transactions[0].offsets.topics[0].partitions[0], { partition: 0, offset: "5" })
  await worker.stop()
})

test("does not open Kafka transaction when journey projection fails", async () => {
  const kafka = fakeKafka()
  const worker = runtime(kafka, { resolve: async () => { throw new Error("postgres unavailable") } })
  await worker.start()

  await assert.rejects(() => kafka.deliver(), /postgres unavailable/)
  assert.equal(kafka.transactions.length, 0)
  await worker.stop()
})

test("aborts journey handoff when Kafka transaction fails", async () => {
  const kafka = fakeKafka({ failCommit: true })
  const worker = runtime(kafka, { resolve: async () => resolution })
  await worker.start()

  await assert.rejects(() => kafka.deliver(), /transaction failed/)
  assert.equal(kafka.transactions[0].aborted, true)
  await worker.stop()
})

test("marks journey runtime unhealthy after consumer crash", async () => {
  const errors = []
  const kafka = fakeKafka()
  const worker = runtime(kafka, { resolve: async () => resolution }, (error) => errors.push(error))
  await worker.start()
  kafka.crash(new Error("consumer failed"))

  assert.equal(worker.isHealthy(), false)
  assert.match(errors[0].message, /consumer failed/)
  await worker.stop()
})
