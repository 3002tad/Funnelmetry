import pg from 'pg'
import {Kafka, logLevel} from 'kafkajs'
import {fieldsByTable, persistContextChange} from './projection.js'

const sourceId = process.env.INVENTORY_PRICE_CDC_SOURCE_ID
const epochId = process.env.INVENTORY_PRICE_CDC_COVERAGE_EPOCH
const prefix = process.env.INVENTORY_PRICE_CDC_TOPIC_PREFIX
const brokers = (process.env.KAFKA_BOOTSTRAP_SERVERS ?? '').split(',').filter(Boolean)
const groupId = process.env.INVENTORY_PRICE_CDC_GROUP_ID
if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(sourceId ?? '') ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(epochId ?? '') ||
    prefix !== 'cdc_shadow_medusa_inventory_price_v2' ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(groupId ?? '') ||
    brokers.length !== 1 || !brokers[0]) {
  throw Error('inventory_price_cdc_configuration_invalid')
}
const topics = Object.keys(fieldsByTable).map(table => `${prefix}.public.${table}`)
const postgres = process.env.DATABASE_URL
  ? {connectionString: process.env.DATABASE_URL}
  : {host: process.env.POSTGRES_HOST, port: Number(process.env.POSTGRES_PORT ?? 5432),
    database: process.env.POSTGRES_DB, user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD}
const pool = new pg.Pool({...postgres, max: 3, connectionTimeoutMillis: 10000})
const kafka = new Kafka({clientId: `inventory-price-cdc-writer-${epochId}`, brokers,
  logLevel: logLevel.ERROR, retry: {retries: 3}})
const consumer = kafka.consumer({groupId, readUncommitted: false})
let stopping = false
let resolveStop
const stopped = new Promise(resolve => {resolveStop = resolve})
const crashed = new Promise((_, reject) => consumer.on(consumer.events.CRASH,
  event => reject(event.payload.error)))

async function shutdown() {
  if (stopping) return
  stopping = true
  await consumer.stop().catch(() => {})
  await consumer.disconnect().catch(() => {})
  await pool.end()
  resolveStop()
}
process.once('SIGTERM', () => {void shutdown()})
process.once('SIGINT', () => {void shutdown()})

try {
  const {rows} = await pool.query(`SELECT
    to_regclass('public.inventory_price_cdc_context_current') IS NOT NULL AS installed`)
  if (!rows[0]?.installed) throw Error('inventory_price_cdc_schema_missing')
  await consumer.connect()
  for (const topic of topics) await consumer.subscribe({topic, fromBeginning: true})
  await consumer.run({autoCommit: false, partitionsConsumedConcurrently: 1,
    eachMessage: async ({topic, partition, message}) => {
      const client = await pool.connect()
      try {
        const key = message.key === null ? null : JSON.parse(message.key.toString('utf8'))
        const value = message.value === null ? null : JSON.parse(message.value.toString('utf8'))
        await persistContextChange(client, {sourceId, epochId, prefix, topic, partition,
          offset: message.offset, key, value})
      } finally {client.release()}
      await consumer.commitOffsets([{topic, partition, offset:
        (BigInt(message.offset) + 1n).toString()}])
    }})
  console.info(JSON.stringify({service:'inventory-price-cdc-writer',status:'READY',
    source_id:sourceId,coverage_epoch_id:epochId,scope:'CONTEXT_ONLY'}))
  await Promise.race([stopped, crashed])
} catch (error) {
  console.error(JSON.stringify({service:'inventory-price-cdc-writer',status:'FATAL',
    code:String(error.message).slice(0,100)}))
  process.exitCode = 1
  await shutdown()
}
