import pg from 'pg'
import { Kafka, logLevel } from 'kafkajs'

// Raw, keyed context only. No sellable-stock, display-price or order-value claim.
const prefix = 'cdc_shadow_medusa_inventory_price'
const sourceId = 'medusa-reference'
const tableFields = new Map([
  ['product_sales_channel', ['id', 'product_id', 'sales_channel_id']],
  ['sales_channel', ['id', 'name', 'is_disabled']],
  ['sales_channel_stock_location', ['id', 'sales_channel_id', 'stock_location_id']],
  ['stock_location', ['id', 'name']],
  ['product_variant_inventory_item', ['id', 'variant_id', 'inventory_item_id', 'required_quantity']],
  ['inventory_item', ['id', 'sku', 'requires_shipping', 'deleted_at']],
  ['inventory_level', ['id', 'inventory_item_id', 'location_id', 'stocked_quantity', 'reserved_quantity', 'incoming_quantity']],
  ['reservation_item', ['id', 'inventory_item_id', 'location_id', 'quantity', 'allow_backorder']],
  ['product_variant_price_set', ['id', 'variant_id', 'price_set_id']],
  ['price_set', ['id']],
  ['price', ['id', 'price_set_id', 'currency_code', 'amount', 'price_list_id', 'min_quantity', 'max_quantity', 'rules_count', 'deleted_at']],
  ['price_list', ['id', 'status', 'starts_at', 'ends_at', 'type', 'rules_count', 'deleted_at']],
  ['price_rule', ['id', 'price_id', 'attribute', 'operator', 'value', 'priority']],
  ['price_list_rule', ['id', 'price_list_id', 'attribute', 'value']],
  ['region', ['id', 'currency_code']],
  ['currency', ['code', 'decimal_digits', 'deleted_at']],
])
const compositeKeys = new Map([
  ['product_sales_channel', ['product_id', 'sales_channel_id']],
  ['sales_channel_stock_location', ['sales_channel_id', 'stock_location_id']],
  ['product_variant_inventory_item', ['variant_id', 'inventory_item_id']],
  ['product_variant_price_set', ['variant_id', 'price_set_id']],
])
const softDeleteTables = new Set(['inventory_item', 'price', 'price_list', 'currency'])
const topics = [...tableFields.keys()].map(table => `${prefix}.public.${table}`)
const databaseUrl = process.env.DATABASE_URL
const brokers = (process.env.KAFKA_BROKERS ?? '').split(',').filter(Boolean)
const groupId = process.env.KAFKA_GROUP_ID
const epoch = process.env.CDC_COVERAGE_EPOCH

if (!databaseUrl || new URL(databaseUrl).hostname !== 'inventory-price-projection-db' ||
    brokers.length !== 1 || brokers[0] !== 'kafka:9092' ||
    groupId !== 'cdc-shadow-inventory-price-projector-v1' ||
    process.env.CDC_TOPIC_PREFIX !== prefix || process.env.SOURCE_ID !== sourceId ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(epoch ?? '')) {
  throw Error('inventory/price projector must use its private shadow scope and epoch')
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 10000 })
const kafka = new Kafka({ clientId: 'cdc-shadow-inventory-price-projector', brokers,
  logLevel: logLevel.ERROR, retry: { retries: 3 } })
const consumer = kafka.consumer({ groupId, readUncommitted: false })

const schema = `
CREATE TABLE IF NOT EXISTS context_input_offsets (
  topic text NOT NULL, partition integer NOT NULL, next_offset bigint NOT NULL,
  PRIMARY KEY(topic,partition)
);
CREATE TABLE IF NOT EXISTS context_cdc_audit (
  topic text NOT NULL, partition integer NOT NULL, kafka_offset bigint NOT NULL,
  table_name text NOT NULL, row_key jsonb, op text NOT NULL,
  source_lsn bigint, source_ts_ms bigint, snapshot_marker text,
  payload jsonb, ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(topic,partition,kafka_offset)
);
CREATE TABLE IF NOT EXISTS context_rows_current (
  coverage_epoch_id text NOT NULL, source_id text NOT NULL,
  table_name text NOT NULL, row_key jsonb NOT NULL, payload jsonb NOT NULL,
  soft_deleted boolean NOT NULL, source_lsn bigint,
  topic text NOT NULL, last_topic_offset bigint NOT NULL,
  observed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(coverage_epoch_id,source_id,table_name,row_key)
);
CREATE INDEX IF NOT EXISTS context_rows_table ON context_rows_current(
  coverage_epoch_id,source_id,table_name,soft_deleted);
CREATE OR REPLACE VIEW inventory_price_context_active AS
SELECT coverage_epoch_id,source_id,table_name,row_key,payload,source_lsn,
       topic,last_topic_offset,observed_at FROM context_rows_current
WHERE NOT soft_deleted;
`

function primaryKeyFields(table) {
  return compositeKeys.get(table) ?? [table === 'currency' ? 'code' : 'id']
}

function projected(table, keyObject, value) {
  const fields = tableFields.get(table)
  if (!fields || !keyObject || typeof keyObject !== 'object' || Array.isArray(keyObject)) {
    throw Error('inventory/price CDC key is missing or out of scope')
  }
  const keyFields = primaryKeyFields(table)
  if (Object.keys(keyObject).length !== keyFields.length || keyFields.some(field =>
    typeof keyObject[field] !== 'string' || !keyObject[field])) {
    throw Error('inventory/price CDC key differs from source primary key')
  }
  const key = keyFields.map(field => keyObject[field])
  if (value === null) return null // Debezium delete tombstone
  if (!value || !['r', 'c', 'u', 'd'].includes(value.op)) throw Error('invalid context CDC operation')
  const source = value.source ?? {}
  if (source.name !== prefix || source.db !== 'medusa' || source.schema !== 'public' ||
      source.table !== table || (source.lsn != null && !Number.isSafeInteger(source.lsn)) ||
      (value.op !== 'r' && source.lsn == null)) {
    throw Error('foreign or incomplete inventory/price source envelope')
  }
  const marker = source.snapshot
  if (value.op === 'r' ? ![true, 'true', 'first', 'first_in_data_collection',
    'last_in_data_collection', 'last'].includes(marker)
    : ![false, 'false', null, undefined].includes(marker)) {
    throw Error('invalid inventory/price snapshot marker')
  }
  const data = value.op === 'd' ? value.before : value.after
  if (value.op !== 'd' && (!data || Object.keys(data).length !== fields.length ||
      fields.some(field => !(field in data)) || keyFields.some(field => data[field] !== keyObject[field]))) {
    throw Error('inventory/price row differs from exact column allowlist or key')
  }
  if (value.op === 'd' && data && Object.keys(data).some(field => !fields.includes(field))) {
    throw Error('inventory/price delete includes an unapproved column')
  }
  return { op: value.op, table, key, data: value.op === 'd' ? null : data,
    lsn: source.lsn == null ? null : String(source.lsn), tsMs: source.ts_ms ?? null,
    snapshotMarker: value.op === 'r' ? String(marker) : null }
}

async function consume({ topic, partition, message }) {
  if (partition !== 0 || !topics.includes(topic)) throw Error('unexpected context topic or partition')
  const table = topic.slice(`${prefix}.public.`.length)
  const key = message.key === null ? null : JSON.parse(message.key.toString('utf8'))
  const value = message.value === null ? null : JSON.parse(message.value.toString('utf8'))
  const row = projected(table, key, value)
  const offset = BigInt(message.offset)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const saved = await client.query(`SELECT next_offset FROM context_input_offsets
      WHERE topic=$1 AND partition=$2 FOR UPDATE`, [topic, partition])
    const expected = BigInt(saved.rows[0]?.next_offset ?? 0)
    if (offset > expected) throw Error('inventory/price topic offset gap')
    if (offset === expected) {
      if (row) {
        await client.query(`INSERT INTO context_cdc_audit
          (topic,partition,kafka_offset,table_name,row_key,op,source_lsn,
           source_ts_ms,snapshot_marker,payload)
          VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10::jsonb)`,
        [topic, partition, message.offset, table, JSON.stringify(row.key), row.op,
          row.lsn, row.tsMs, row.snapshotMarker,
          row.data === null ? null : JSON.stringify(row.data)])
        if (row.op === 'd') {
          await client.query(`DELETE FROM context_rows_current
            WHERE coverage_epoch_id=$1 AND source_id=$2 AND table_name=$3 AND row_key=$4::jsonb`,
          [epoch, sourceId, table, JSON.stringify(row.key)])
        } else {
          await client.query(`INSERT INTO context_rows_current
            (coverage_epoch_id,source_id,table_name,row_key,payload,soft_deleted,
             source_lsn,topic,last_topic_offset)
            VALUES($1,$2,$3,$4::jsonb,$5::jsonb,$6,$7,$8,$9)
            ON CONFLICT(coverage_epoch_id,source_id,table_name,row_key) DO UPDATE SET
              payload=EXCLUDED.payload,soft_deleted=EXCLUDED.soft_deleted,
              source_lsn=EXCLUDED.source_lsn,topic=EXCLUDED.topic,
              last_topic_offset=EXCLUDED.last_topic_offset,observed_at=now()`,
          [epoch, sourceId, table, JSON.stringify(row.key), JSON.stringify(row.data),
            softDeleteTables.has(table) && row.data.deleted_at !== null,
            row.lsn, topic, message.offset])
        }
      }
      await client.query(`INSERT INTO context_input_offsets(topic,partition,next_offset)
        VALUES($1,$2,$3) ON CONFLICT(topic,partition) DO UPDATE
        SET next_offset=EXCLUDED.next_offset`, [topic, partition, (offset + 1n).toString()])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally { client.release() }
  await consumer.commitOffsets([{ topic, partition, offset: (offset + 1n).toString() }])
}

let stopping = false
let resolveStop
const shutdown = new Promise(resolve => { resolveStop = resolve })
const crash = new Promise((_, reject) => consumer.on(consumer.events.CRASH,
  event => reject(event.payload.error)))
async function stop() {
  if (stopping) return
  stopping = true
  await consumer.stop().catch(() => {})
  await consumer.disconnect().catch(() => {})
  await pool.end()
  resolveStop()
}
process.once('SIGTERM', () => { void stop() })
process.once('SIGINT', () => { void stop() })

try {
  await pool.query(schema)
  const admin = kafka.admin()
  await admin.connect()
  try {
    const existing = new Set(await admin.listTopics())
    const missing = topics.filter(topic => !existing.has(topic))
    if (missing.length) await admin.createTopics({ topics: missing.map(topic => ({ topic,
      numPartitions: 1, replicationFactor: 1 })), waitForLeaders: true })
  } finally { await admin.disconnect() }
  await consumer.connect()
  for (const topic of topics) await consumer.subscribe({ topic, fromBeginning: true })
  console.info(JSON.stringify({ service: 'inventory-price-projector', status: 'READY',
    scope: 'INVENTORY_PRICE_CONTEXT_SHADOW_ONLY', coverage_epoch_id: epoch }))
  await consumer.run({ autoCommit: false, partitionsConsumedConcurrently: 1,
    eachMessage: consume })
  await Promise.race([shutdown, crash])
} catch (error) {
  console.error(JSON.stringify({ service: 'inventory-price-projector', code: 'FATAL',
    message: String(error.message).slice(0, 160) }))
  process.exitCode = 1
  await stop()
}
