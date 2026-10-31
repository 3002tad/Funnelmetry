import pg from 'pg'
import { Kafka, logLevel } from 'kafkajs'
import { postgresConfig } from '../../shared/postgres-config.mjs'
import { persistCartChange } from './projection.js'

const sourceId = process.env.CART_CDC_SOURCE_ID
const epochId = process.env.CART_CDC_COVERAGE_EPOCH
const prefix = process.env.CART_CDC_TOPIC_PREFIX
const groupId = process.env.CART_CDC_GROUP_ID
const canonicalTopic = process.env.KAFKA_TOPIC_CANONICAL
const brokers = (process.env.KAFKA_BOOTSTRAP_SERVERS ?? '').split(',').filter(Boolean)
const identifier = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/
if (![sourceId, epochId, prefix, groupId, canonicalTopic].every(value => identifier.test(value ?? '')) ||
    brokers.length !== 1) throw Error('cart_cdc_configuration_invalid')

const topic = `${prefix}.public.cart_line_item`
const pool = new pg.Pool({ ...postgresConfig(), max: 3, connectionTimeoutMillis: 10000 })
const kafka = new Kafka({ clientId: `cart-cdc-mapper-${epochId}`, brokers,
  logLevel: logLevel.ERROR, retry: { retries: 3 } })
const consumer = kafka.consumer({ groupId, readUncommitted: false })
const producer = kafka.producer({ allowAutoTopicCreation: false, idempotent: true, maxInFlightRequests: 1 })
let stopping = false
let resolveStop
const stopped = new Promise(resolve => { resolveStop = resolve })
const crashed = new Promise((_, reject) => consumer.on(consumer.events.CRASH,
  event => reject(event.payload.error)))

async function flushOutbox() {
  for (;;) {
    const { rows } = await pool.query(`SELECT canonical_event_id,canonical_event
      FROM cart_cdc_canonical_outbox WHERE source_id=$1 AND coverage_epoch_id=$2
        AND delivered_at IS NULL ORDER BY created_at,canonical_event_id LIMIT 100`, [sourceId, epochId])
    if (!rows.length) return
    for (const row of rows) {
      const event = row.canonical_event
      await producer.send({ topic: canonicalTopic,
        messages: [{ key: JSON.stringify([event.source_id, event.source_event_id]),
          value: JSON.stringify(event) }] })
      await pool.query(`UPDATE cart_cdc_canonical_outbox SET delivered_at=clock_timestamp()
        WHERE canonical_event_id=$1 AND delivered_at IS NULL`, [row.canonical_event_id])
    }
  }
}

async function shutdown() {
  if (stopping) return
  stopping = true
  await consumer.stop().catch(() => {})
  await Promise.allSettled([consumer.disconnect(), producer.disconnect()])
  await pool.end()
  resolveStop()
}
process.once('SIGTERM', () => { void shutdown() })
process.once('SIGINT', () => { void shutdown() })

try {
  const { rows } = await pool.query(`SELECT
    to_regclass('public.cart_cdc_line_state') IS NOT NULL AS installed`)
  if (!rows[0]?.installed) throw Error('cart_cdc_schema_missing')
  await producer.connect()
  await flushOutbox()
  await consumer.connect()
  await consumer.subscribe({ topic, fromBeginning: true })
  await consumer.run({ autoCommit: false, partitionsConsumedConcurrently: 1,
    eachMessage: async ({ topic: inputTopic, partition, message }) => {
      const client = await pool.connect()
      try {
        await persistCartChange(client, { sourceId, epochId, prefix, topic: inputTopic,
          partition, offset: message.offset,
          key: message.key === null ? null : JSON.parse(message.key.toString('utf8')),
          value: message.value === null ? null : JSON.parse(message.value.toString('utf8')) })
      } finally { client.release() }
      await flushOutbox()
      await consumer.commitOffsets([{ topic: inputTopic, partition,
        offset: (BigInt(message.offset) + 1n).toString() }])
    } })
  console.info(JSON.stringify({ service: 'cart-line-item-cdc-mapper', status: 'READY',
    source_id: sourceId, coverage_epoch_id: epochId }))
  await Promise.race([stopped, crashed])
} catch (error) {
  console.error(JSON.stringify({ service: 'cart-line-item-cdc-mapper', status: 'FATAL',
    code: String(error.message).slice(0, 100) }))
  process.exitCode = 1
  await shutdown()
}
