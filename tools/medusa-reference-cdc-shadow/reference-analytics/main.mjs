import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { Kafka, logLevel } from 'kafkajs'

const topic = 'cdc_shadow_reference.order_recorded_state.v1'
const databaseUrl = process.env.DATABASE_URL
const brokers = (process.env.KAFKA_BROKERS ?? '').split(',').filter(Boolean)
const groupId = process.env.KAFKA_GROUP_ID
if (!databaseUrl || new URL(databaseUrl).hostname !== 'reference-analytics-db' ||
    process.env.FACT_TOPIC !== topic || brokers.length !== 1 || brokers[0] !== 'kafka:9092' ||
    !/^cdc-shadow-reference-analytics-[a-z0-9-]+$/.test(groupId ?? '')) {
  throw Error('reference analytics must use only the private shadow DB and fact topic')
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 3, connectionTimeoutMillis: 10000 })
const kafka = new Kafka({ clientId: 'cdc-shadow-reference-analytics', brokers,
  logLevel: logLevel.ERROR, retry: { retries: 3 } })
const consumer = kafka.consumer({ groupId, readUncommitted: false })
const metadata = JSON.parse(await readFile(new URL('./metadata.json', import.meta.url), 'utf8'))

const schema = `
CREATE TABLE IF NOT EXISTS reference_fact_changes (
  fact_change_id text PRIMARY KEY,
  source_instance_id text NOT NULL,
  order_id text NOT NULL,
  cart_id text NOT NULL,
  active boolean NOT NULL,
  revision_end_id text NOT NULL,
  observed_state_at timestamptz,
  payload jsonb NOT NULL,
  kafka_partition integer NOT NULL,
  kafka_offset bigint NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kafka_partition,kafka_offset)
);
CREATE TABLE IF NOT EXISTS reference_order_current_state (
  source_instance_id text NOT NULL,
  order_id text NOT NULL,
  cart_id text NOT NULL,
  active boolean NOT NULL,
  last_change_id text NOT NULL REFERENCES reference_fact_changes(fact_change_id),
  last_revision_end_id text NOT NULL,
  observed_state_at timestamptz,
  last_topic_offset bigint NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(source_instance_id,order_id)
);
CREATE TABLE IF NOT EXISTS reference_sink_offsets (
  topic text NOT NULL,
  partition integer NOT NULL,
  next_offset bigint NOT NULL,
  PRIMARY KEY(topic,partition)
);
CREATE TABLE IF NOT EXISTS reference_semantic_catalog (
  catalog_id text NOT NULL,
  version text NOT NULL,
  definition jsonb NOT NULL,
  sha256 text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(catalog_id,version)
);
`

async function registerMetadata() {
  if (metadata.status !== 'SHADOW_ONLY' || metadata.pipeline_catalog_published !== false ||
      metadata.asset?.relation !== 'public.reference_order_current_state' ||
      metadata.execution_binding?.relation !== metadata.asset.relation ||
      metadata.metric?.asset_id !== metadata.asset.id ||
      metadata.asset?.contract_id !== 'reference.medusa.order_recorded_state.v1') {
    throw Error('invalid reference analytical metadata scope/binding')
  }
  const columns = await pool.query(`SELECT column_name,data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='reference_order_current_state'`)
  const physical = new Map(columns.rows.map(row => [row.column_name, row.data_type]))
  for (const [column, type] of Object.entries(metadata.asset.required_columns)) {
    if (physical.get(column) !== type) throw Error(`missing physical binding: ${column}`)
  }
  const content = JSON.stringify(metadata)
  const checksum = createHash('sha256').update(content).digest('hex')
  await pool.query(`INSERT INTO reference_semantic_catalog(catalog_id,version,definition,sha256)
    VALUES($1,$2,$3::jsonb,$4) ON CONFLICT(catalog_id,version) DO NOTHING`,
  [metadata.catalog_id, metadata.version, content, checksum])
  const saved = await pool.query(`SELECT sha256 FROM reference_semantic_catalog
    WHERE catalog_id=$1 AND version=$2`, [metadata.catalog_id, metadata.version])
  if (saved.rows[0]?.sha256 !== checksum) throw Error('shadow semantic metadata version changed without bump')
}

function validateFact(value) {
  if (!value || value.contract_id !== 'reference.medusa.order_recorded_state.v1' ||
      value.quality !== 'REFERENCE_APPROXIMATE' || value.coverage !== 'POST_ACTIVATION_ONLY' ||
      !/^[a-z0-9][a-z0-9-]{2,62}$/.test(value.source_instance_id ?? '') ||
      !/^order_[A-Za-z0-9]+$/.test(value.order_id ?? '') ||
      !/^cart_[A-Za-z0-9]+$/.test(value.cart_id ?? '') ||
      !/^[0-9a-f]{64}$/.test(value.fact_change_id ?? '') ||
      !/^\d+:\d+$/.test(value.revision_end_id ?? '') ||
      typeof value.active !== 'boolean' ||
      (value.observed_state_at !== null &&
        (typeof value.observed_state_at !== 'string' ||
         !/^\d{4}-\d\d-\d\dT/.test(value.observed_state_at) ||
         !Number.isFinite(Date.parse(value.observed_state_at))))) {
    throw Error('invalid shadow reference fact contract')
  }
  return value
}

async function persistFact({ topic: inputTopic, partition, message }) {
  if (inputTopic !== topic || partition !== 0) throw Error('unexpected reference fact topic/partition')
  const value = validateFact(JSON.parse(message.value?.toString('utf8') ?? 'null'))
  const offset = (BigInt(message.offset) + 1n).toString()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const inserted = await client.query(`INSERT INTO reference_fact_changes
      (fact_change_id,source_instance_id,order_id,cart_id,active,revision_end_id,
       observed_state_at,payload,kafka_partition,kafka_offset)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)
      ON CONFLICT(fact_change_id) DO NOTHING RETURNING fact_change_id`,
    [value.fact_change_id, value.source_instance_id, value.order_id, value.cart_id,
      value.active, value.revision_end_id, value.observed_state_at,
      JSON.stringify(value), partition, message.offset])
    if (!inserted.rowCount) {
      const saved = await client.query(`SELECT payload=$2::jsonb AS same
        FROM reference_fact_changes WHERE fact_change_id=$1`,
      [value.fact_change_id, JSON.stringify(value)])
      if (!saved.rows[0]?.same) throw Error('conflicting reference fact change ID')
    } else {
      const previous = await client.query(`SELECT active,last_topic_offset
        FROM reference_order_current_state WHERE source_instance_id=$1 AND order_id=$2 FOR UPDATE`,
      [value.source_instance_id, value.order_id])
      if ((!previous.rows.length && !value.active) ||
          (previous.rows.length && previous.rows[0].active === value.active) ||
          (previous.rows.length && BigInt(previous.rows[0].last_topic_offset) >= BigInt(message.offset))) {
        throw Error('invalid or out-of-order reference state transition')
      }
      await client.query(`INSERT INTO reference_order_current_state
        (source_instance_id,order_id,cart_id,active,last_change_id,last_revision_end_id,
         observed_state_at,last_topic_offset)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT(source_instance_id,order_id) DO UPDATE SET
          cart_id=EXCLUDED.cart_id,active=EXCLUDED.active,
          last_change_id=EXCLUDED.last_change_id,
          last_revision_end_id=EXCLUDED.last_revision_end_id,
          observed_state_at=EXCLUDED.observed_state_at,
          last_topic_offset=EXCLUDED.last_topic_offset,updated_at=now()`,
      [value.source_instance_id, value.order_id, value.cart_id, value.active,
        value.fact_change_id, value.revision_end_id, value.observed_state_at, message.offset])
    }
    await client.query(`INSERT INTO reference_sink_offsets(topic,partition,next_offset)
      VALUES($1,$2,$3) ON CONFLICT(topic,partition)
      DO UPDATE SET next_offset=GREATEST(reference_sink_offsets.next_offset,EXCLUDED.next_offset)`,
    [inputTopic, partition, offset])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
  await consumer.commitOffsets([{ topic: inputTopic, partition, offset }])
}

let stopping = false
let resolveShutdown
const shutdown = new Promise(resolve => { resolveShutdown = resolve })
const consumerCrash = new Promise((_, reject) => {
  consumer.on(consumer.events.CRASH, event => reject(event.payload.error))
})
async function stop() {
  if (stopping) return
  stopping = true
  await consumer.stop().catch(() => {})
  await consumer.disconnect().catch(() => {})
  await pool.end()
  resolveShutdown()
}
process.once('SIGTERM', () => { void stop() })
process.once('SIGINT', () => { void stop() })

try {
  await pool.query(schema)
  await registerMetadata()
  await consumer.connect()
  await consumer.subscribe({ topic, fromBeginning: true })
  console.info(JSON.stringify({ service: 'reference-analytics-sink', status: 'READY', topic }))
  await consumer.run({ autoCommit: false, partitionsConsumedConcurrently: 1,
    eachMessage: persistFact })
  await Promise.race([shutdown, consumerCrash])
} catch (error) {
  console.error(JSON.stringify({ service: 'reference-analytics-sink', code: 'FATAL',
    message: String(error.message).slice(0, 180) }))
  process.exitCode = 1
  await stop()
}
