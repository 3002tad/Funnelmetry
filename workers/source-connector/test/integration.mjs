import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { Kafka, logLevel } from 'kafkajs'
import { INGRESS_EVENT_SPEC_VERSION } from '@3002tad/funnelmetry-input-contract'
import { createConnector } from '../src/connector.js'
import { openPostgresCursorStore } from '../src/postgres-cursor-store.js'
import { createKafkaPublisher } from '../src/kafka-publisher.js'
import { createKafkaNormalizerRuntime } from '../../canonical-normalizer/src/kafka-runtime.js'
import { createKafkaLedgerRuntime } from '../../canonical-ledger-writer/src/kafka-runtime.js'
import { createCanonicalLedgerRepository } from '../../canonical-ledger-writer/src/repository.js'

const pool = new pg.Pool({ connectionString: 'postgresql://connector_test:connector_test@postgres/connector_test' })
const kafka = new Kafka({ clientId: 'connector-integration', brokers: ['kafka:9092'], logLevel: logLevel.NOTHING })
const admin = kafka.admin(), producer = kafka.producer({ transactionalId: 'connector-integration', idempotent: true, maxInFlightRequests: 1 })
const consumer = kafka.consumer({ groupId: `verify-${Date.now()}`, readUncommitted: false })
const initialCursor = { event_feed_id: 'test-feed', after_seq: 0 }
const open = () => openPostgresCursorStore({ pool, connectorId: 'test', initialCursor })
let store
let normalizer, ledger
const runtimeErrors = []
try {
  await pool.query(await readFile(new URL('../../../infra/postgres/v2/001_canonical_ledger.sql', import.meta.url), 'utf8'))
  const migration = await readFile(new URL('../../../infra/postgres/v2/019_source_connector_cursors.sql', import.meta.url), 'utf8')
  await pool.query(migration)
  await pool.query(migration) // Migration is rerunnable.
  store = await open()
  await assert.rejects(open(), { code: 'CONNECTOR_ALREADY_OWNED' })
  await admin.connect()
  await admin.createTopics({ topics: ['test-raw', 'test-receipts', 'test-canonical', 'test-outcomes', 'test-quarantine', 'test-persisted']
    .map(topic => ({ topic, numPartitions: 1, replicationFactor: 1 })) })
  await producer.connect()
  const publish = createKafkaPublisher({ producer, rawTopic: 'test-raw', receiptTopic: 'test-receipts' })
  const records = [1, 3, 5].map(seq => ({ event_feed_id: initialCursor.event_feed_id, ingress_seq: seq, accepted_at: '2026-09-18T00:00:00Z',
    specversion: INGRESS_EVENT_SPEC_VERSION, source_id: 'integration-test', event_id: `test:${seq}`,
    source_event_type: seq === 5 ? 'unknown.event' : 'behavior.page_viewed', source_schema_version: '2.0', producer: 'browser_sdk',
    occurred_at: '2026-09-18T00:00:00Z', source_payload: { page_type: 'home', path_template: '/', page_instance_id: `page-${seq}` } }))
  const feedClient = { read: async c => ({ event_feed_id: 'test-feed', events: records.filter(r => r.ingress_seq > c.after_seq),
    next_after_seq: 5, latest_available_seq: 5, retention_floor_seq: 0 }) }
  // Real Kafka commit followed by simulated process failure before DB save.
  await assert.rejects(createConnector({ feedClient, publish, cursorStore: {
    load: () => store.load(), assertOwned: () => store.assertOwned(), advance: async () => { throw new Error('simulated-crash') },
  } }).pollOnce(), /simulated-crash/)
  assert.equal((await store.load()).after_seq, 0)
  store.close(); store = await open()
  await createConnector({ feedClient, publish, cursorStore: store }).pollOnce()
  assert.equal((await store.load()).after_seq, 5)
  store.close(); store = await open()
  assert.equal((await store.load()).after_seq, 5)
  // Start fresh downstream groups AFTER publishing: they must consume retained raw.
  normalizer = createKafkaNormalizerRuntime({ brokers: ['kafka:9092'], clientId: 'test-normalizer', consumerGroupId: 'test-normalizer', instanceId: '1',
    rawTopic: 'test-raw', canonicalTopic: 'test-canonical', outcomeTopic: 'test-outcomes', quarantineTopic: 'test-quarantine', onError: e => runtimeErrors.push(e) })
  ledger = createKafkaLedgerRuntime({ brokers: ['kafka:9092'], clientId: 'test-ledger', consumerGroupId: 'test-ledger', instanceId: '1',
    canonicalTopic: 'test-canonical', persistedTopic: 'test-persisted', repository: createCanonicalLedgerRepository({ pool }), onError: e => runtimeErrors.push(e) })
  await ledger.start(); await normalizer.start()
  const seen = { 'test-raw': [], 'test-receipts': [], 'test-outcomes': [], 'test-quarantine': [], 'test-persisted': [] }
  await consumer.connect()
  await consumer.subscribe({ topics: Object.keys(seen), fromBeginning: true })
  await consumer.run({ eachMessage: async ({ topic, message }) => seen[topic].push(JSON.parse(message.value.toString())) })
  const deadline = Date.now() + 30000
  while ((seen['test-persisted'].length < 3 || seen['test-outcomes'].length < 4 || seen['test-quarantine'].length < 1) && Date.now() < deadline && !runtimeErrors.length) await new Promise(r => setTimeout(r, 100))
  assert.deepEqual(runtimeErrors.map(e => e.message), [])
  assert.equal(seen['test-raw'].length, 4)
  assert.equal(seen['test-receipts'].length, 4)
  assert.deepEqual(seen['test-raw'].map(r => r.ingress_seq), [1, 1, 3, 5])
  assert.equal(seen['test-raw'][0].ingestion_id, seen['test-raw'][1].ingestion_id)
  assert.equal(seen['test-persisted'].length, 3)
  assert.equal(seen['test-quarantine'].length, 1)
  const rows = (await pool.query('SELECT source_event_id, event_type, event_class FROM canonical_events ORDER BY source_event_id')).rows
  assert.equal(rows.length, 2)
  assert.deepEqual(rows.map(r => r.source_event_id), ['test:1', 'test:3'])
  assert.ok(rows.every(r => r.event_type === 'behavior.page_viewed' && r.event_class === 'CLIENT_OBSERVATION'))
  assert.deepEqual(seen['test-persisted'][0].canonical_event, seen['test-persisted'][1].canonical_event)
  // Conflicting business content must still fail instead of being treated as replay.
  const original = seen['test-persisted'][0].canonical_event
  await assert.rejects(createCanonicalLedgerRepository({ pool }).persist({ ...original, data: { ...original.data, page_type: 'product' } }), /conflicts/)
  console.log('PASS: Connector -> Kafka -> normalizer -> ledger; 4 raw deliveries, 2 unique canonical rows, 1 quarantine; replay and conflict checks passed.')
} finally {
  await normalizer?.stop().catch(() => {})
  await ledger?.stop().catch(() => {})
  await consumer.disconnect().catch(() => {})
  await producer.disconnect().catch(() => {})
  await admin.disconnect().catch(() => {})
  store?.close(); await pool.end()
}
