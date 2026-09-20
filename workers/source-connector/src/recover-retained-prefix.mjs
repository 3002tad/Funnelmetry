// Operator-only bounded recovery. NORMAL connector must remain stopped.
// Requires the entire retained prefix AND already completed DB projections.
// Does not implement arbitrary snapshot recovery or change the persisted cursor.
import assert from 'node:assert/strict'
import pg from 'pg'
import { Kafka, logLevel } from 'kafkajs'
import { loadConfig } from './config.js'
import { createFeedClient } from './feed-client.js'
import { validateFeed, toRawMessage } from './connector.js'
import { openPostgresCursorStore } from './postgres-cursor-store.js'
import { createKafkaPublisher } from './kafka-publisher.js'

const config = loadConfig()
assert.equal(process.env.RECOVERY_CONFIRM, 'REPLAY_RETAINED_COMPLETED_PREFIX', 'Explicit operator confirmation required')
const pool = new pg.Pool({ connectionString: config.databaseUrl })
const kafka = new Kafka({ clientId: 'prefix-recovery', brokers: config.brokers, logLevel: logLevel.NOTHING })
const producer = kafka.producer({ transactionalId: `source-connector-${config.id}`, idempotent: true, maxInFlightRequests: 1 })
let store
try {
  store = await openPostgresCursorStore({ pool, connectorId: config.id, initialCursor: config.initialCursor })
  const saved = await store.load()
  assert.equal(String(saved.after_seq), process.env.RECOVERY_EXPECTED_CURSOR, 'Unexpected saved cursor')
  assert.ok(saved.after_seq > 0)
  const feed = createFeedClient({ ...config, waitSeconds: 0 })
  let cursor = { ...saved, after_seq: 0 }
  const messages = []
  // Bounded operator tool, not an unbounded archival downloader.
  while (cursor.after_seq < saved.after_seq) {
    const response = await feed.read({ ...cursor, limit: config.limit })
    const records = validateFeed(response, cursor, config.limit).filter(r => r.ingress_seq <= saved.after_seq)
    assert.ok(records.length, 'Prefix unavailable')
    for (const record of records) {
      const receipt = await pool.query('SELECT received_at, ingestion_id FROM ingress_accepted_receipts WHERE source_id=$1 AND event_id=$2', [record.source_id, record.event_id])
      assert.equal(receipt.rowCount, 1, 'Missing persisted receipt')
      const raw = toRawMessage(record, receipt.rows[0].received_at.toISOString())
      assert.equal(JSON.parse(raw.value).ingestion_id, receipt.rows[0].ingestion_id, 'Receipt identity mismatch')
      const result = await pool.query(`SELECT o.status, o.raw_record_id,
        c.canonical_event_id, j.journey_id, k.trigger_event_id,
        k.changed_instance_count, k.changed_instances
        FROM canonicalization_latest_outcomes o
        LEFT JOIN canonical_events c ON c.canonical_event_id=o.canonical_event_id
        LEFT JOIN journey_events j ON j.canonical_event_id=c.canonical_event_id
        LEFT JOIN kpi_projection_applications k ON k.trigger_event_id=c.canonical_event_id
        WHERE o.source_id=$1 AND o.source_event_id=$2`, [record.source_id, record.event_id])
      assert.equal(result.rowCount, 1, 'Missing terminal outcome')
      const outcome = result.rows[0]
      assert.equal(outcome.raw_record_id, receipt.rows[0].ingestion_id)
      if (outcome.status === 'normalized') {
        assert.ok(outcome.canonical_event_id && outcome.journey_id && outcome.trigger_event_id, 'Incomplete downstream projection; requires general restore procedure')
        assert.ok(outcome.changed_instance_count === 0 || outcome.changed_instances !== null, 'Missing KPI handoff evidence')
      } else assert.ok(['quarantined', 'unsupported'].includes(outcome.status))
      messages.push(raw)
      assert.ok(messages.length <= 10000, 'Recovery bound exceeded')
      cursor = { ...cursor, after_seq: record.ingress_seq }
    }
  }
  assert.equal(cursor.after_seq, saved.after_seq)
  console.log(JSON.stringify({ status: 'validated', records: messages.length, after_seq: saved.after_seq }))
  if (process.env.RECOVERY_VALIDATE_ONLY !== 'true') {
    await producer.connect()
    const publish = createKafkaPublisher({ producer, rawTopic: config.rawTopic, receiptTopic: config.receiptTopic })
    for (const message of messages) { await store.assertOwned(); await publish(message) }
    assert.deepEqual(await store.load(), saved)
    console.log(JSON.stringify({ status: 'replayed', records: messages.length, cursor_unchanged: true }))
  }
} catch (error) {
  // Never log arbitrary driver errors, SQL values, source payloads or credentials.
  console.error(JSON.stringify({ status: 'recovery_failed', code: error.code || 'RECOVERY_CHECK_FAILED' }))
  process.exitCode = 1
} finally {
  await producer.disconnect().catch(() => {})
  store?.close()
  await pool.end()
}
