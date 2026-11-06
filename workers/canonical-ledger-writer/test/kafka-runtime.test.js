import test from "node:test"
import assert from "node:assert/strict"
import { createKafkaLedgerRuntime } from "../src/kafka-runtime.js"
import { canonicalEvent } from "./fixtures.js"
import { createWorkerHealth } from '../../shared/health-server.mjs'

function fakeKafka({ failTransactionCommit = false, onTransactionCommit = () => {}, autoJoin = true } = {}) {
  const calls = []
  let eachMessage
  let finishRun
  const handlers = new Map()
  const producerHandlers = new Map()
  const transactions = []
  const producer = {
    events: { CONNECT: 'producer.connect', DISCONNECT: 'producer.disconnect' },
    on: (event, handler) => producerHandlers.set(event, handler),
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
    events: { CRASH: "crash", GROUP_JOIN: 'join', REBALANCING: 'rebalance', STOP: 'stop', DISCONNECT: 'disconnect' },
    on: (event, handler) => { handlers.set(event, handler) },
    connect: async () => calls.push("consumer.connect"),
    disconnect: async () => calls.push("consumer.disconnect"),
    subscribe: async () => calls.push("consumer.subscribe"),
    run: (options) => {
      calls.push(`consumer.run:autoCommit=${options.autoCommit}`)
      eachMessage = options.eachMessage
      if (autoJoin) handlers.get('join')?.({ payload: { groupId: 'ledger-v1' } })
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
    crash(error, restart = false) { handlers.get('crash')({ payload: { error, restart } }) },
    emit(event, payload = {}) { handlers.get(event)?.({ payload }) },
    emitProducer(event) { producerHandlers.get(event)?.({}) },
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

test('startup waits for group join; a retriable startup crash recovers without a new event', async () => {
  const kafka = fakeKafka({ autoJoin: false })
  const worker = runtime(kafka, { persist: async () => {} })
  await worker.start()
  assert.equal(worker.isHealthy(), false)
  kafka.crash(new Error('coordinator loading'), true)
  kafka.emit('join', { groupId: 'foreign-group' })
  assert.equal(worker.isHealthy(), false)
  kafka.emit('join', { groupId: 'ledger-v1' })
  assert.equal(worker.isHealthy(), true)
  await worker.stop()
})

test('rebalancing and producer disconnect are not ready; confirmed connections restore readiness', async () => {
  const kafka = fakeKafka()
  const worker = runtime(kafka, { persist: async () => {} })
  await worker.start()
  assert.equal(worker.isHealthy(), true)
  kafka.emit('rebalance')
  assert.equal(worker.isHealthy(), false)
  kafka.emit('join', { groupId: 'ledger-v1' })
  assert.equal(worker.isHealthy(), true)
  kafka.emitProducer('producer.disconnect')
  assert.equal(worker.isHealthy(), false)
  kafka.emit('join', { groupId: 'ledger-v1' })
  assert.equal(worker.isHealthy(), false)
  kafka.emitProducer('producer.connect')
  assert.equal(worker.isHealthy(), true)
  await worker.stop()
  kafka.emit('join', { groupId: 'ledger-v1' })
  kafka.emitProducer('producer.connect')
  assert.equal(worker.isHealthy(), false)
})

test('a rejoin cannot hide PostgreSQL failure; only a successful persisted transaction clears it', async () => {
  let fail = true
  const kafka = fakeKafka()
  const worker = runtime(kafka, { persist: async () => {
    if (fail) throw Error('postgres unavailable')
    return { persisted_at: '2026-11-06T00:00:00Z', canonical_event: canonicalEvent }
  } })
  await worker.start()
  await assert.rejects(kafka.deliver(), /postgres unavailable/)
  assert.equal(worker.isHealthy(), false)
  assert.equal(kafka.transactions.length, 0)
  kafka.crash(Error('postgres unavailable'), true)
  kafka.emit('join', { groupId: 'ledger-v1' })
  assert.equal(worker.isHealthy(), false)
  fail = false
  await kafka.deliver()
  assert.equal(kafka.transactions[0].committed, true)
  assert.equal(worker.isHealthy(), true)
  await worker.stop()
})

test('failed Kafka commit remains degraded across rejoin and clears only after commit succeeds', async () => {
  let fail = true
  const kafka = fakeKafka({ onTransactionCommit: () => { if (fail) throw Error('commit failed') } })
  const worker = runtime(kafka, { persist: async () => ({ persisted_at: '2026-11-06T00:00:00Z', canonical_event: canonicalEvent }) })
  await worker.start()
  await assert.rejects(kafka.deliver(), /commit failed/)
  assert.equal(kafka.transactions[0].aborted, true)
  kafka.crash(Error('transaction failed'), true)
  kafka.emit('join', { groupId: 'ledger-v1' })
  assert.equal(worker.isHealthy(), false)
  fail = false
  await kafka.deliver()
  assert.equal(worker.isHealthy(), true)
  await worker.stop()
})

test('fatal crash cannot become ready through a late join or successful callback', async () => {
  const kafka = fakeKafka()
  const worker = runtime(kafka, { persist: async () => ({ persisted_at: '2026-11-06T00:00:00Z', canonical_event: canonicalEvent }) })
  await worker.start()
  kafka.crash(Error('fatal producer epoch'), false)
  kafka.emit('join', { groupId: 'ledger-v1' })
  await kafka.deliver()
  assert.equal(worker.isHealthy(), false)
  await worker.stop()
})

test('HTTP readiness recovers after retriable rejoin while liveness remains available', async () => {
  const kafka = fakeKafka()
  const worker = runtime(kafka, { persist: async () => {} })
  const health = createWorkerHealth({ worker: 'canonical-ledger-writer', runtime: worker,
    isStopping: () => false, port: 0, host: '127.0.0.1' })
  const port = await health.start()
  const get = path => fetch(`http://127.0.0.1:${port}${path}`)
  try {
    await worker.start(); health.markStarted()
    assert.equal((await get('/readyz')).status, 200)
    kafka.crash(Error('coordinator loading'), true)
    assert.equal((await get('/readyz')).status, 503)
    assert.equal((await get('/healthz')).status, 200)
    kafka.emit('join', { groupId: 'ledger-v1' })
    const ready = await get('/readyz')
    assert.equal(ready.status, 200)
    assert.equal((await ready.json()).status, 'READY')
  } finally { await worker.stop(); await health.stop() }
})
