import assert from "node:assert/strict"
import test from "node:test"
import { createKafkaIngressTelemetryRuntime } from "../src/kafka-runtime.js"

const receipt = Object.freeze({
  status: "accepted",
  source_id: "medusa-reference",
  event_id: "browser:event-1",
  ingestion_id: "ing_1",
  ingestion_attempt_id: "attempt-1",
  received_at: "2026-09-01T01:00:00.000Z",
})

const outcome = Object.freeze({
  source_id: "medusa-reference",
  source_event_id: "browser:event-1",
  status: "normalized",
  canonical_event_id: "can_1",
  mapping_version: "mapping-v1",
  processed_at: "2026-09-01T01:00:01.000Z",
  raw_record_id: "ing_1",
})

function fakeKafka() {
  const calls = []
  const commits = []
  let eachMessage
  let finishRun
  let crashHandler
  const consumer = {
    events: { CRASH: "crash" },
    on: (_event, handler) => { crashHandler = handler },
    connect: async () => calls.push("connect"),
    disconnect: async () => calls.push("disconnect"),
    subscribe: async (options) => calls.push({ subscribe: options }),
    commitOffsets: async (offsets) => commits.push(offsets),
    run: (options) => {
      eachMessage = options.eachMessage
      calls.push(`run:autoCommit=${options.autoCommit}`)
      return new Promise((resolve) => { finishRun = resolve })
    },
    stop: async () => { calls.push("stop"); finishRun?.() },
  }
  return {
    calls,
    commits,
    consumer: () => consumer,
    deliver(topic, document, key = [document.source_id, document.event_id ?? document.source_event_id]) {
      return eachMessage({
        topic,
        partition: 2,
        message: {
          offset: "7",
          key: Buffer.from(JSON.stringify(key)),
          value: Buffer.from(JSON.stringify(document)),
        },
      })
    },
    crash(error) { crashHandler({ payload: { error } }) },
  }
}

function runtime(kafka, repository, onError = () => {}) {
  return createKafkaIngressTelemetryRuntime({
    kafka,
    repository,
    brokers: ["unused:9092"],
    clientId: "telemetry",
    consumerGroupId: "telemetry-v1",
    receiptTopic: "receipts",
    outcomeTopic: "outcomes",
    onError,
  })
}

test("commits each receipt offset only after PostgreSQL persistence", async () => {
  let persisted = false
  const kafka = fakeKafka()
  const worker = runtime(kafka, {
    persistReceipt: async () => { persisted = true },
    persistOutcome: async () => assert.fail(),
  })
  await worker.start()
  await kafka.deliver("receipts", receipt)
  assert.equal(persisted, true)
  assert.deepEqual(kafka.commits[0], [{ topic: "receipts", partition: 2, offset: "8" }])
  await worker.stop()
})

test("routes canonicalization outcomes to their repository method", async () => {
  let observed
  const kafka = fakeKafka()
  const worker = runtime(kafka, {
    persistReceipt: async () => assert.fail(),
    persistOutcome: async (value) => { observed = value },
  })
  await worker.start()
  await kafka.deliver("outcomes", outcome)
  assert.equal(observed.status, "normalized")
  assert.equal(kafka.commits.length, 1)
  await worker.stop()
})

test("does not commit an offset when PostgreSQL persistence fails", async () => {
  const kafka = fakeKafka()
  const worker = runtime(kafka, {
    persistReceipt: async () => { throw new Error("postgres unavailable") },
    persistOutcome: async () => {},
  })
  await worker.start()
  await assert.rejects(() => kafka.deliver("receipts", receipt), /postgres unavailable/)
  assert.equal(kafka.commits.length, 0)
  await worker.stop()
})

test("rejects a Kafka key that does not match telemetry identity", async () => {
  const kafka = fakeKafka()
  const worker = runtime(kafka, {
    persistReceipt: async () => assert.fail(),
    persistOutcome: async () => assert.fail(),
  })
  await worker.start()
  await assert.rejects(
    () => kafka.deliver("outcomes", outcome, [outcome.source_id, "browser:other"]),
    /key does not match/,
  )
  assert.equal(kafka.commits.length, 0)
  await worker.stop()
})

test("marks telemetry runtime unhealthy after consumer crash", async () => {
  const errors = []
  const kafka = fakeKafka()
  const worker = runtime(kafka, {
    persistReceipt: async () => {},
    persistOutcome: async () => {},
  }, (error) => errors.push(error))
  await worker.start()
  kafka.crash(new Error("consumer failed"))
  assert.equal(worker.isHealthy(), false)
  assert.match(errors[0].message, /consumer failed/)
  await worker.stop()
})
