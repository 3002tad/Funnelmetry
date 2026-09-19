import test from "node:test"
import assert from "node:assert/strict"
import { createKafkaLedgerRuntime } from "../src/kafka-runtime.js"
import { canonicalEvent } from "./fixtures.js"

function fakeKafka({ failTransactionCommit = false, onTransactionCommit = () => {} } = {}) {
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
          onTransactionCommit()
          if (failTransactionCommit) throw new Error("Kafka transaction failed")
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
    subscribe: async () => calls.push("consumer.subscribe"),
    run: (options) => {
      calls.push(`consumer.run:autoCommit=${options.autoCommit}`)
      eachMessage = options.eachMessage
      return new Promise((resolve) => { finishRun = resolve })
    },
    stop: async () => { calls.push("consumer.stop"); finishRun?.() },
  }
  return {
    calls,
    transactions,
    producer: () => producer,
    consumer: () => consumer,
    deliver(event = canonicalEvent, keyIdentity = [event.source_id, event.source_event_id]) {
      return eachMessage({
        topic: "canonical",
        partition: 1,
        message: {
          offset: "9",
          key: Buffer.from(JSON.stringify(keyIdentity)),
          value: Buffer.from(JSON.stringify(event)),
        },
      })
    },
    crash(error) { crashHandler({ payload: { error } }) },
  }
}

function runtime(kafka, repository, onError = () => {}) {
  return createKafkaLedgerRuntime({
    kafka,
    repository,
    brokers: ["unused:9092"],
    clientId: "ledger",
    consumerGroupId: "ledger-v1",
    instanceId: "ledger-1",
    canonicalTopic: "canonical",
    persistedTopic: "canonical-persisted",
    onError,
  })
}

test("commits Kafka offset only after PostgreSQL persistence", async () => {
  let persisted = false
  const kafka = fakeKafka({ onTransactionCommit: () => assert.equal(persisted, true) })
  const worker = runtime(kafka, {
    persist: async () => {
      persisted = true
      return { status: "inserted", persisted_at: "2026-08-29T01:00:03.000Z", canonical_event: canonicalEvent }
    },
  })
  await worker.start()
  await kafka.deliver()

  assert.equal(persisted, true)
  assert.equal(kafka.transactions[0].sends[0].topic, "canonical-persisted")
  assert.deepEqual(kafka.transactions[0].offsets, {
    consumerGroupId: "ledger-v1",
    topics: [{ topic: "canonical", partitions: [{ partition: 1, offset: "10" }] }],
  })
  assert.equal(kafka.transactions[0].committed, true)
  await worker.stop()
})

test("does not commit Kafka offset when PostgreSQL fails", async () => {
  const kafka = fakeKafka()
  const worker = runtime(kafka, { persist: async () => { throw new Error("postgres unavailable") } })
  await worker.start()

  await assert.rejects(() => kafka.deliver(), /postgres unavailable/)
  assert.equal(kafka.transactions.length, 0)
  await worker.stop()
})

test("rejects a Kafka key that does not match canonical identity", async () => {
  const kafka = fakeKafka()
  const worker = runtime(kafka, { persist: async () => assert.fail() })
  await worker.start()
  const mismatched = { ...canonicalEvent, source_event_id: "source:other" }

  await assert.rejects(
    () => kafka.deliver(mismatched, [canonicalEvent.source_id, canonicalEvent.source_event_id]),
    /Kafka key does not match/,
  )
  await worker.stop()
})

test("aborts persisted handoff when its Kafka transaction fails", async () => {
  const kafka = fakeKafka({ failTransactionCommit: true })
  const worker = runtime(kafka, {
    persist: async () => ({ status: "inserted", persisted_at: "2026-08-29T01:00:03.000Z", canonical_event: canonicalEvent }),
  })
  await worker.start()

  await assert.rejects(() => kafka.deliver(), /Kafka transaction failed/)
  assert.equal(kafka.transactions[0].aborted, true)
  await worker.stop()
})

test("marks the ledger unhealthy when the consumer crashes", async () => {
  const errors = []
  const kafka = fakeKafka()
  const worker = runtime(kafka, { persist: async () => {} }, (error) => errors.push(error))
  await worker.start()
  kafka.crash(new Error("consumer failed"))

  assert.equal(worker.isHealthy(), false)
  assert.match(errors[0].message, /consumer failed/)
  await worker.stop()
})
