import pg from 'pg'
import { Kafka, logLevel } from 'kafkajs'

// Four-table, shadow-only catalog projection. The order-state CDC contract,
// live Dashboard and catalog-sync are outside this consumer's write scope.
const prefix = 'cdc_shadow_medusa_catalog'
const sourceId = 'medusa-reference'
const tableFields = new Map([
  ['product', ['id', 'title', 'handle', 'status', 'collection_id', 'updated_at', 'deleted_at']],
  ['product_variant', ['id', 'product_id', 'title', 'sku', 'manage_inventory', 'allow_backorder', 'updated_at', 'deleted_at']],
  ['product_category', ['id', 'name', 'parent_category_id', 'is_active', 'is_internal', 'updated_at', 'deleted_at']],
  ['product_category_product', ['product_id', 'product_category_id']],
])
const topics = [...tableFields.keys()].map(table => `${prefix}.public.${table}`)
const databaseUrl = process.env.DATABASE_URL
const brokers = (process.env.KAFKA_BROKERS ?? '').split(',').filter(Boolean)
const groupId = process.env.KAFKA_GROUP_ID
if (!databaseUrl || new URL(databaseUrl).hostname !== 'catalog-projection-db' ||
    brokers.length !== 1 || brokers[0] !== 'kafka:9092' ||
    groupId !== 'cdc-shadow-catalog-projector-v1' ||
    process.env.CDC_TOPIC_PREFIX !== prefix || process.env.SOURCE_ID !== sourceId) {
  throw Error('catalog projector must use only its private shadow DB, topics and consumer group')
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 10000 })
const kafka = new Kafka({ clientId: 'cdc-shadow-catalog-projector', brokers,
  logLevel: logLevel.ERROR, retry: { retries: 3 } })
const consumer = kafka.consumer({ groupId, readUncommitted: false })

const schema = `
CREATE TABLE IF NOT EXISTS catalog_input_offsets (
  topic text NOT NULL, partition integer NOT NULL, next_offset bigint NOT NULL,
  PRIMARY KEY(topic,partition)
);
CREATE TABLE IF NOT EXISTS catalog_cdc_audit (
  topic text NOT NULL, partition integer NOT NULL, kafka_offset bigint NOT NULL,
  table_name text NOT NULL, row_key text NOT NULL, op text NOT NULL,
  source_lsn bigint, source_ts_ms bigint, snapshot_marker text,
  projected_payload jsonb, ingested_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(topic,partition,kafka_offset)
);
CREATE TABLE IF NOT EXISTS catalog_capture_status (
  source_id text PRIMARY KEY, snapshot_last_seen boolean NOT NULL DEFAULT false,
  snapshot_last_topic text, snapshot_last_offset bigint,
  last_input_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS catalog_products_current (
  source_id text NOT NULL, product_id text NOT NULL, title text, handle text,
  status text, collection_id text, source_updated_raw text,
  soft_deleted boolean NOT NULL, source_lsn bigint,
  last_topic_offset bigint NOT NULL,
  PRIMARY KEY(source_id,product_id)
);
CREATE TABLE IF NOT EXISTS catalog_variants_current (
  source_id text NOT NULL, variant_id text NOT NULL, product_id text NOT NULL,
  title text, sku text, manage_inventory boolean, allow_backorder boolean,
  source_updated_raw text, soft_deleted boolean NOT NULL,
  source_lsn bigint, last_topic_offset bigint NOT NULL,
  PRIMARY KEY(source_id,variant_id)
);
CREATE INDEX IF NOT EXISTS catalog_variants_product ON catalog_variants_current(source_id,product_id);
CREATE TABLE IF NOT EXISTS catalog_categories_current (
  source_id text NOT NULL, category_id text NOT NULL, name text,
  parent_category_id text, is_active boolean, is_internal boolean,
  source_updated_raw text, soft_deleted boolean NOT NULL,
  source_lsn bigint, last_topic_offset bigint NOT NULL,
  PRIMARY KEY(source_id,category_id)
);
CREATE TABLE IF NOT EXISTS catalog_product_categories_current (
  source_id text NOT NULL, product_id text NOT NULL, category_id text NOT NULL,
  source_lsn bigint, last_topic_offset bigint NOT NULL,
  PRIMARY KEY(source_id,product_id,category_id)
);
CREATE OR REPLACE VIEW catalog_product_reference_names_cdc AS
SELECT source_id,product_id,title,status,source_updated_raw,
  last_topic_offset FROM catalog_products_current
WHERE NOT soft_deleted;
`

function projected(table, value) {
  if (value === null) return null // Debezium tombstone after a delete
  if (!value || !['r', 'c', 'u', 'd'].includes(value.op)) throw Error('invalid catalog CDC operation')
  const source = value.source ?? {}
  if (source.name !== prefix || source.db !== 'medusa' || source.schema !== 'public' ||
      source.table !== table || (source.lsn != null && !Number.isSafeInteger(source.lsn)) ||
      (value.op !== 'r' && source.lsn == null)) {
    throw Error('foreign or incomplete catalog source envelope')
  }
  const marker = source.snapshot
  if (value.op === 'r' ? ![true, 'true', 'first', 'first_in_data_collection',
    'last_in_data_collection', 'last'].includes(marker)
    : ![false, 'false', null, undefined].includes(marker)) {
    throw Error('invalid catalog snapshot marker')
  }
  const row = value.op === 'd' ? value.before : value.after
  const required = tableFields.get(table)
  if (!row || (value.op !== 'd' &&
      (Object.keys(row).length !== required.length || required.some(field => !(field in row))))) {
    throw Error('catalog row differs from exact column allowlist')
  }
  const key = table === 'product_category_product'
    ? [row.product_id, row.product_category_id] : [row.id]
  if (key.some(part => typeof part !== 'string' || !part)) throw Error('catalog row lacks primary key')
  if (value.op === 'd' && Object.keys(row).some(field => !required.includes(field))) {
    throw Error('catalog delete includes an unapproved column')
  }
  return { op: value.op, table, key: JSON.stringify(key),
    data: Object.fromEntries(required.map(field => [field, row[field] ?? null])),
    lsn: source.lsn == null ? null : String(source.lsn), tsMs: source.ts_ms ?? null,
    snapshotMarker: value.op === 'r' ? String(marker) : null }
}

async function applyRow(client, row, offset) {
  const data = row.data
  if (row.table === 'product') {
    if (row.op === 'd') {
      await client.query('DELETE FROM catalog_products_current WHERE source_id=$1 AND product_id=$2', [sourceId, data.id])
    } else {
      await client.query(`INSERT INTO catalog_products_current
        (source_id,product_id,title,handle,status,collection_id,source_updated_raw,
         soft_deleted,source_lsn,last_topic_offset)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(source_id,product_id) DO UPDATE SET
          title=EXCLUDED.title,handle=EXCLUDED.handle,status=EXCLUDED.status,
          collection_id=EXCLUDED.collection_id,source_updated_raw=EXCLUDED.source_updated_raw,
          soft_deleted=EXCLUDED.soft_deleted,source_lsn=EXCLUDED.source_lsn,
          last_topic_offset=EXCLUDED.last_topic_offset`,
      [sourceId, data.id, data.title, data.handle, data.status, data.collection_id,
        String(data.updated_at), data.deleted_at !== null, row.lsn, offset])
    }
  } else if (row.table === 'product_variant') {
    if (row.op === 'd') {
      await client.query('DELETE FROM catalog_variants_current WHERE source_id=$1 AND variant_id=$2', [sourceId, data.id])
    } else {
      if (!data.product_id) throw Error('variant has no product relation')
      await client.query(`INSERT INTO catalog_variants_current
        (source_id,variant_id,product_id,title,sku,manage_inventory,allow_backorder,
         source_updated_raw,soft_deleted,source_lsn,last_topic_offset)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        ON CONFLICT(source_id,variant_id) DO UPDATE SET
          product_id=EXCLUDED.product_id,title=EXCLUDED.title,sku=EXCLUDED.sku,
          manage_inventory=EXCLUDED.manage_inventory,allow_backorder=EXCLUDED.allow_backorder,
          source_updated_raw=EXCLUDED.source_updated_raw,soft_deleted=EXCLUDED.soft_deleted,
          source_lsn=EXCLUDED.source_lsn,last_topic_offset=EXCLUDED.last_topic_offset`,
      [sourceId, data.id, data.product_id, data.title, data.sku,
        data.manage_inventory, data.allow_backorder, String(data.updated_at),
        data.deleted_at !== null, row.lsn, offset])
    }
  } else if (row.table === 'product_category') {
    if (row.op === 'd') {
      await client.query('DELETE FROM catalog_categories_current WHERE source_id=$1 AND category_id=$2', [sourceId, data.id])
    } else {
      await client.query(`INSERT INTO catalog_categories_current
        (source_id,category_id,name,parent_category_id,is_active,is_internal,
         source_updated_raw,soft_deleted,source_lsn,last_topic_offset)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT(source_id,category_id) DO UPDATE SET
          name=EXCLUDED.name,parent_category_id=EXCLUDED.parent_category_id,
          is_active=EXCLUDED.is_active,is_internal=EXCLUDED.is_internal,
          source_updated_raw=EXCLUDED.source_updated_raw,soft_deleted=EXCLUDED.soft_deleted,
          source_lsn=EXCLUDED.source_lsn,last_topic_offset=EXCLUDED.last_topic_offset`,
      [sourceId, data.id, data.name, data.parent_category_id,
        data.is_active, data.is_internal, String(data.updated_at),
        data.deleted_at !== null, row.lsn, offset])
    }
  } else {
    if (row.op === 'd') {
      await client.query(`DELETE FROM catalog_product_categories_current
        WHERE source_id=$1 AND product_id=$2 AND category_id=$3`,
      [sourceId, data.product_id, data.product_category_id])
    } else {
      await client.query(`INSERT INTO catalog_product_categories_current
        (source_id,product_id,category_id,source_lsn,last_topic_offset)
        VALUES($1,$2,$3,$4,$5)
        ON CONFLICT(source_id,product_id,category_id) DO UPDATE SET
          source_lsn=EXCLUDED.source_lsn,last_topic_offset=EXCLUDED.last_topic_offset`,
      [sourceId, data.product_id, data.product_category_id, row.lsn, offset])
    }
  }
}

async function consume({ topic, partition, message }) {
  if (partition !== 0 || !topics.includes(topic)) throw Error('unexpected catalog topic or partition')
  const table = topic.slice(`${prefix}.public.`.length)
  const offset = BigInt(message.offset)
  const value = message.value === null ? null : JSON.parse(message.value.toString('utf8'))
  const row = projected(table, value)
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const saved = await client.query(`SELECT next_offset FROM catalog_input_offsets
      WHERE topic=$1 AND partition=$2 FOR UPDATE`, [topic, partition])
    const expected = BigInt(saved.rows[0]?.next_offset ?? 0)
    if (offset > expected) throw Error('catalog topic offset gap')
    if (offset === expected) {
      if (row) {
        await client.query(`INSERT INTO catalog_cdc_audit
          (topic,partition,kafka_offset,table_name,row_key,op,source_lsn,
           source_ts_ms,snapshot_marker,projected_payload)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)`,
        [topic, partition, message.offset, table, row.key, row.op, row.lsn,
          row.tsMs, row.snapshotMarker, JSON.stringify(row.data)])
        await applyRow(client, row, message.offset)
        await client.query(`INSERT INTO catalog_capture_status
          (source_id,snapshot_last_seen,snapshot_last_topic,snapshot_last_offset)
          VALUES($1,$2,$3,$4) ON CONFLICT(source_id) DO UPDATE SET
            snapshot_last_seen=catalog_capture_status.snapshot_last_seen OR EXCLUDED.snapshot_last_seen,
            snapshot_last_topic=CASE WHEN EXCLUDED.snapshot_last_seen THEN EXCLUDED.snapshot_last_topic
              ELSE catalog_capture_status.snapshot_last_topic END,
            snapshot_last_offset=CASE WHEN EXCLUDED.snapshot_last_seen THEN EXCLUDED.snapshot_last_offset
              ELSE catalog_capture_status.snapshot_last_offset END,
            last_input_at=now()`,
        [sourceId, row.snapshotMarker === 'last', topic, message.offset])
      }
      await client.query(`INSERT INTO catalog_input_offsets(topic,partition,next_offset)
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
  await consumer.connect()
  for (const topic of topics) await consumer.subscribe({ topic, fromBeginning: true })
  console.info(JSON.stringify({ service: 'catalog-projector', status: 'READY',
    scope: 'PRODUCT_VARIANT_CATEGORY_SHADOW_ONLY' }))
  await consumer.run({ autoCommit: false, partitionsConsumedConcurrently: 1,
    eachMessage: consume })
  await Promise.race([shutdown, crash])
} catch (error) {
  console.error(JSON.stringify({ service: 'catalog-projector', code: 'FATAL',
    message: String(error.message).slice(0, 160) }))
  process.exitCode = 1
  await stop()
}
