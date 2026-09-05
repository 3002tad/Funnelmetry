import assert from "node:assert/strict"
import test from "node:test"
import { createKafkaDurableIngress, createReceiptIndex } from "../src/index.js"

const event = {
  specversion: "ingress-event.v1",
  source_id: "medusa-reference",
  event_id: "medusa:order-1:placed:v1",
  source_event_type: "order.placed",
  source_schema_version: "1.0",
  occurred_at: "2026-08-27T03:00:00.000Z",
  producer: "source_bridge",
  source_payload: { order_id: "order_1" },
}

const context = {
  raw_body: JSON.stringify(event),
  received_at: "2026-08-27T03:00:01.000Z",
  ingestion_attempt_id: "attempt-1",
  auth: { key_id: "medusa-backend-dev", method: "hmac_sha256" },
}

function createProducer({ failCommit = false, waitForCommit } = {}) {
  const transactions = []
  return {
    transactions,
    async transaction() {
      const state = { sends: [], committed: false, aborted: false }
      transactions.push(state)
      return {
        async send(record) {
          state.sends.push(record)
        },
        async commit() {
          if (waitForCommit) await waitForCommit()
          if (failCommit) throw new Error("commit failed")
          state.committed = true
        },
        async abort() {
          state.aborted = true
        },
      }
    },
  }
}

function createReadyIndex() {
  const index = createReceiptIndex()
  index.markReady()
  return index
}

function createAdapter(producer, receiptIndex = createReadyIndex()) {
  return {
    receiptIndex,
    adapter: createKafkaDurableIngress({
      producer,
      receiptIndex,
      rawTopic: "funnelmetry.ingress.raw.v1",
      receiptTopic: "funnelmetry.ingress.receipts.v1",
      createIngestionId: () => "ing_1",
    }),
  }
}

test("does not accept traffic before the durable receipt index is ready", async () => {
  const producer = createProducer()
  const receiptIndex = createReceiptIndex()
  const { adapter } = createAdapter(producer, receiptIndex)

  await assert.rejects(() => adapter.accept(event, context), /receipt index is not ready/)
  assert.equal(producer.transactions.length, 0)
})

test("atomically writes raw data and its receipt before indexing accepted", async () => {
  const producer = createProducer()
  const { adapter, receiptIndex } = createAdapter(producer)
  const receipt = await adapter.accept(event, context)

  assert.equal(receipt.status, "accepted")
  assert.equal(receipt.ingestion_id, "ing_1")
  assert.equal(producer.transactions.length, 1)
  const transaction = producer.transactions[0]
  assert.equal(transaction.sends.length, 2)
  assert.equal(transaction.sends[0].topic, "funnelmetry.ingress.raw.v1")
  assert.equal(transaction.sends[1].topic, "funnelmetry.ingress.receipts.v1")
  assert.equal(transaction.sends[0].messages[0].key, transaction.sends[1].messages[0].key)
  assert.equal(JSON.parse(transaction.sends[0].messages[0].value).raw_body, context.raw_body)
  assert.equal(transaction.committed, true)
  assert.equal(receiptIndex.get(event.source_id, event.event_id).ingestion_id, "ing_1")
})

test("returns duplicate without opening another Kafka transaction", async () => {
  const producer = createProducer()
  const { adapter } = createAdapter(producer)
  const first = await adapter.accept(event, context)
  const duplicate = await adapter.accept(event, { ...context, ingestion_attempt_id: "attempt-2" })

  assert.equal(duplicate.status, "duplicate")
  assert.equal(duplicate.ingestion_id, first.ingestion_id)
  assert.equal(duplicate.ingestion_attempt_id, "attempt-2")
  assert.equal(producer.transactions.length, 1)
})

test("aborts a failed transaction and leaves the receipt index unchanged", async () => {
  const producer = createProducer({ failCommit: true })
  const { adapter, receiptIndex } = createAdapter(producer)

  await assert.rejects(() => adapter.accept(event, context), /commit failed/)
  assert.equal(producer.transactions[0].aborted, true)
  assert.equal(receiptIndex.size(), 0)
})

test("serializes concurrent retries for the same source event", async () => {
  let releaseCommit
  const commitGate = new Promise((resolve) => { releaseCommit = resolve })
  const producer = createProducer({ waitForCommit: () => commitGate })
  const { adapter } = createAdapter(producer)

  const firstPromise = adapter.accept(event, context)
  const duplicatePromise = adapter.accept(event, { ...context, ingestion_attempt_id: "attempt-2" })
  while (producer.transactions.length === 0) await new Promise((resolve) => setImmediate(resolve))
  releaseCommit()
  const [first, duplicate] = await Promise.all([firstPromise, duplicatePromise])

  assert.equal(first.status, "accepted")
  assert.equal(duplicate.status, "duplicate")
  assert.equal(producer.transactions.length, 1)
})

test("hydrates durable receipts before becoming ready", () => {
  const index = createReceiptIndex()
  index.hydrate([{
    status: "accepted",
    source_id: event.source_id,
    event_id: event.event_id,
    ingestion_id: "ing_existing",
    received_at: context.received_at,
  }])
  index.markReady()

  assert.equal(index.isReady(), true)
  assert.equal(index.get(event.source_id, event.event_id).ingestion_id, "ing_existing")
})

test("uses a shared coordinator as the authority across gateway replicas", async () => {
  let acceptedReceipt
  let ownerToken
  const coordinator = {
    async claim({ receipt }) {
      if (acceptedReceipt) return { status: "duplicate", receipt: acceptedReceipt, owner_token: null }
      ownerToken = "gateway-1:claim-1"
      return { status: "claimed", receipt, owner_token: ownerToken }
    },
    async complete({ owner_token }) {
      assert.equal(owner_token, ownerToken)
      acceptedReceipt = {
        status: "accepted", source_id: event.source_id, event_id: event.event_id,
        ingestion_id: "ing_shared", received_at: context.received_at,
      }
    },
    async release() {},
  }
  const firstProducer = createProducer()
  const secondProducer = createProducer()
  const first = createKafkaDurableIngress({
    producer: firstProducer, receiptIndex: createReadyIndex(), receiptCoordinator: coordinator,
    rawTopic: "raw", receiptTopic: "receipts", createIngestionId: () => "ing_shared",
  })
  const second = createKafkaDurableIngress({
    producer: secondProducer, receiptIndex: createReadyIndex(), receiptCoordinator: coordinator,
    rawTopic: "raw", receiptTopic: "receipts", createIngestionId: () => "ing_other",
  })

  assert.equal((await first.accept(event, context)).status, "accepted")
  const duplicate = await second.accept(event, { ...context, ingestion_attempt_id: "attempt-2" })
  assert.equal(duplicate.status, "duplicate")
  assert.equal(duplicate.ingestion_id, "ing_shared")
  assert.equal(firstProducer.transactions.length, 1)
  assert.equal(secondProducer.transactions.length, 0)
})
