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

function fakeKafka(receipts = [receipt], { manual = false, targets, failInitialization, failAbort } = {}) {
  const handlers = new Map()
  let processBatch
  let finishRun
  const calls = []
  const producer = {
    connect: async () => calls.push("producer.connect"),
    disconnect: async () => calls.push("producer.disconnect"),
    transaction: async () => {
      calls.push("producer.transaction")
      if (failInitialization) throw new Error("initialization failed")
      return { abort: async () => {
        calls.push("initialization.abort")
        if (failAbort) throw new Error("initialization abort failed")
      } }
    },
  }
  const admin = {
    connect: async () => calls.push("admin.connect"),
    disconnect: async () => calls.push("admin.disconnect"),
    fetchTopicOffsets: async () => targets ?? [{ partition: 0, high: String(receipts.length === 0 ? 0 : receipts.length + 2) }],
  }
  const consumer = {
    events: { CRASH: "crash", END_BATCH_PROCESS: "endBatch" },
    on: (event, handler) => { handlers.set(event, handler) },
    connect: async () => calls.push("consumer.connect"),
    disconnect: async () => calls.push("consumer.disconnect"),
    subscribe: async () => calls.push("consumer.subscribe"),
    run: ({ eachBatch }) => {
      processBatch = eachBatch
      queueMicrotask(async () => {
        if (!manual && receipts.length > 0) {
          await eachBatch({
            batch: {
              partition: 0,
              highWatermark: String(receipts.length + 2),
              lastOffset: () => String(receipts.length + 1),
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
    crash(error) { handlers.get("crash")({ payload: { error } }) },
    async batch({ partition = 0, lastOffset, highWatermark = "100", values = [receipt] }) {
      await processBatch({ batch: { partition, highWatermark, lastOffset: () => lastOffset,
        messages: values.map(value => ({ value: value === null ? null : Buffer.from(JSON.stringify(value)) })),
      } })
    },
    endBatch(payload) { handlers.get("endBatch")({ payload: { topic: "receipts", ...payload } }) },
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
  assert.deepEqual(kafka.calls.slice(0, 6), [
    "producer.connect",
    "producer.transaction",
    "initialization.abort",
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

test("binds producer identity only after initialization and before ready", async () => {
  const kafka = fakeKafka([])
  let identity
  const runtime = createKafkaRuntime({ ...runtimeOptions(kafka), bootId: 'known-boot',
    receiptCoordinator: {
      prepareProducerGeneration: async () => { assert.equal(kafka.calls.length, 0) },
      readyProducerGeneration: async () => { assert.equal(runtime.isReady(), false) },
      bindProducerIdentity: value => {
      assert.equal(kafka.calls.at(-1), 'admin.connect')
      assert.equal(runtime.isReady(), false)
      identity = value
    } },
  })
  await runtime.start()
  assert.deepEqual(identity, { transactionalId: 'gateway-gateway-1', generationId: 'known-boot' })
  await runtime.stop()
})

test('recovery is opt-in, verifies scope, and runs after replay before ready', async () => {
  for (const policy of ['compact', 'delete', 'compact,delete']) {
    const kafka = fakeKafka([])
    kafka.admin().describeCluster = async () => ({ clusterId: 'cluster' })
    kafka.admin().describeConfigs = async () => ({ resources: [{ resourceName: 'receipts',
      configEntries: [{ configName: 'cleanup.policy', configValue: policy }] }] })
    const calls = []
    const runtime = createKafkaRuntime({ ...runtimeOptions(kafka), recoverFencedClaims: true,
      receiptCoordinator: {
        prepareProducerGeneration: async () => calls.push('prepare'),
        bindProducerIdentity: identity => {
          assert.deepEqual(identity.kafkaScope, { clusterId: 'cluster', rawTopic: 'raw', receiptTopic: 'receipts' })
          calls.push('bind')
        },
        recoverFencedClaims: async ({ replayOffsets }) => {
          assert.equal(runtime.isReady(), false)
          assert.equal(kafka.calls.includes('consumer.subscribe'), true)
          assert.deepEqual(replayOffsets, [{ partition: 0, offset: '0' }])
          calls.push('recover')
        },
        readyProducerGeneration: async () => calls.push('ready'),
      },
    })
    if (policy === 'compact') {
      await runtime.start()
      assert.deepEqual(calls, ['prepare', 'bind', 'recover', 'ready'])
    } else {
      await assert.rejects(runtime.start(), /compact-only/)
      assert.equal(runtime.isReady(), false)
      assert.deepEqual(calls, ['prepare'])
    }
    await runtime.stop()
  }
})

test('recovery cannot run before all replay positions or after a replay crash', async () => {
  for (const fail of [false, true]) {
    const kafka = fakeKafka([], { manual: true, targets: [{ partition: 0, high: '3' }] })
    kafka.admin().describeCluster = async () => ({ clusterId: 'cluster' })
    kafka.admin().describeConfigs = async () => ({ resources: [{ resourceName: 'receipts',
      configEntries: [{ configName: 'cleanup.policy', configValue: 'compact' }] }] })
    let recoveries = 0
    const runtime = createKafkaRuntime({ ...runtimeOptions(kafka), recoverFencedClaims: true,
      receiptCoordinator: {
        prepareProducerGeneration: async () => {}, bindProducerIdentity: () => {},
        readyProducerGeneration: async () => {},
        recoverFencedClaims: async () => { recoveries++ },
        confirmReceipt: async () => {},
      },
    })
    const starting = runtime.start()
    const outcome = fail ? assert.rejects(starting, /consumer failed/) : starting
    try {
      await new Promise(resolve => setImmediate(resolve))
      await kafka.batch({ lastOffset: '1' })
      assert.equal(recoveries, 0)
      assert.equal(runtime.isReady(), false)
      if (fail) kafka.crash(new Error('consumer failed'))
      await kafka.batch({ lastOffset: '2' })
      await outcome
      assert.equal(recoveries, fail ? 0 : 1)
      assert.equal(runtime.isReady(), !fail)
    } finally { await runtime.stop() }
  }
})

test('superseded generation fails startup and requires a fresh runtime', async () => {
  const kafka = fakeKafka([])
  const runtime = createKafkaRuntime({ ...runtimeOptions(kafka), receiptCoordinator: {
    prepareProducerGeneration: async () => {}, bindProducerIdentity: () => {},
    readyProducerGeneration: async () => { throw new Error('superseded') },
  } })
  await assert.rejects(runtime.start(), /superseded/)
  assert.equal(runtime.isReady(), false)
  assert.equal(kafka.calls.includes('producer.disconnect'), true)
  await assert.rejects(runtime.start(), /fresh producer generation/)
})

test("startup initialization failure cannot reach replay or ready", async () => {
  for (const options of [{ failInitialization: true }, { failAbort: true }]) {
    const kafka = fakeKafka([], options)
    const runtime = createKafkaRuntime(runtimeOptions(kafka))
    await assert.rejects(runtime.start(), /initialization/)
    assert.equal(runtime.isReady(), false)
    assert.equal(kafka.calls.includes("consumer.subscribe"), false)
    assert.equal(kafka.calls.includes("producer.disconnect"), true)
    await runtime.stop()
  }
})

async function manualRuntime(targets) {
  const kafka = fakeKafka([], { manual: true, targets })
  const runtime = createKafkaRuntime(runtimeOptions(kafka))
  const starting = runtime.start()
  await new Promise(resolve => setImmediate(resolve))
  return { kafka, runtime, starting }
}

test("does not mistake broker high watermark for replayed batches", async () => {
  const { kafka, runtime, starting } = await manualRuntime([{ partition: 0, high: "10" }])
  try {
    await kafka.batch({ lastOffset: "2" })
    assert.equal(runtime.isReady(), false)
    await kafka.batch({ lastOffset: "9", values: [{ ...receipt, event_id: "evt-2" }] })
    await starting
    assert.equal(runtime.isReady(), true)
    assert.equal(runtime.receiptIndex.get("shop", "evt-2").ingestion_id, "ing-1")
  } finally { await runtime.stop() }
})

test("waits for every partition including filtered control records", async () => {
  const { kafka, runtime, starting } = await manualRuntime([
    { partition: 0, high: "3" }, { partition: 1, high: "9007199254740994" },
  ])
  try {
    await kafka.batch({ lastOffset: "2", values: [receipt, null] })
    kafka.endBatch({ topic: "other", partition: 1, lastOffset: "9007199254740993", batchSize: 0 })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(runtime.isReady(), false)
    kafka.endBatch({ partition: 1, lastOffset: "9007199254740992", batchSize: 0 })
    await new Promise(resolve => setImmediate(resolve))
    assert.equal(runtime.isReady(), false)
    kafka.endBatch({ partition: 1, lastOffset: "9007199254740993", batchSize: 0 })
    await starting
    assert.equal(runtime.isReady(), true)
  } finally { await runtime.stop() }
})

test("consumer crash during replay cannot be overwritten by ready", async () => {
  const { kafka, runtime, starting } = await manualRuntime([{ partition: 0, high: "3" }])
  const failed = assert.rejects(starting, /consumer failed/)
  kafka.crash(new Error("consumer failed"))
  await kafka.batch({ lastOffset: "2" })
  await failed
  assert.equal(runtime.isReady(), false)
  await runtime.stop()
})
