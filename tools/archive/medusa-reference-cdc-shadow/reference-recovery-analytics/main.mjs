import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { Kafka, logLevel } from 'kafkajs'

const epoch = 'cdc10-epoch2'
const sourceId = 'medusa-reference-shadow'
const topic = 'cdc_shadow_reference.order_recorded_state.v2'
const url = process.env.DATABASE_URL
if (!url || new URL(url).hostname !== 'recovery-analytics-db' ||
    process.env.KAFKA_BROKERS !== 'kafka:9092' ||
    process.env.KAFKA_GROUP_ID !== 'cdc-shadow-recovery-analytics-v2' ||
    process.env.FACT_TOPIC !== topic || process.env.COVERAGE_EPOCH_ID !== epoch) {
  throw Error('recovery sink requires its separate pinned shadow lineage')
}
const pool = new pg.Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 10000 })
const kafka = new Kafka({ clientId: 'cdc-shadow-recovery-analytics', brokers: ['kafka:9092'],
  logLevel: logLevel.ERROR, retry: { retries: 3 } })
const consumer = kafka.consumer({ groupId: process.env.KAFKA_GROUP_ID, readUncommitted: false })
const metadata = JSON.parse(await readFile(new URL('./metadata.json', import.meta.url), 'utf8'))

const schema = `
CREATE TABLE IF NOT EXISTS recovery_record_inbox (
  record_id text PRIMARY KEY, coverage_epoch_id text NOT NULL,
  source_instance_id text NOT NULL, order_id text NOT NULL,
  record_type text NOT NULL, payload jsonb NOT NULL,
  kafka_partition integer NOT NULL, kafka_offset bigint NOT NULL,
  ingested_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(kafka_partition,kafka_offset)
);
CREATE TABLE IF NOT EXISTS recovery_order_current_state (
  coverage_epoch_id text NOT NULL, source_instance_id text NOT NULL,
  order_id text NOT NULL, cart_id text, active boolean NOT NULL,
  last_record_id text NOT NULL REFERENCES recovery_record_inbox(record_id),
  last_topic_offset bigint NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(coverage_epoch_id,source_instance_id,order_id)
);
CREATE TABLE IF NOT EXISTS recovery_sink_offsets (
  topic text NOT NULL, partition integer NOT NULL, next_offset bigint NOT NULL,
  PRIMARY KEY(topic,partition)
);
CREATE TABLE IF NOT EXISTS recovery_quality_state (
  coverage_epoch_id text PRIMARY KEY, status text NOT NULL,
  historical_gap_status text NOT NULL, baseline_complete boolean NOT NULL DEFAULT false,
  baseline_orders integer, baseline_active_orders integer, baseline_digest text,
  reason text NOT NULL, verified_at timestamptz,
  CHECK(status IN ('BLOCKED_BY_QUALITY','CURRENT_STATE_READY')),
  CHECK(historical_gap_status='INCOMPLETE')
);
CREATE TABLE IF NOT EXISTS recovery_semantic_catalog (
  catalog_id text NOT NULL, version text NOT NULL,
  definition jsonb NOT NULL, sha256 text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(catalog_id,version)
);
CREATE OR REPLACE VIEW recovery_order_current_state_readable AS
  SELECT s.* FROM recovery_order_current_state s
  JOIN recovery_quality_state q USING (coverage_epoch_id)
  WHERE q.status='CURRENT_STATE_READY'
    AND q.baseline_complete
    AND q.historical_gap_status='INCOMPLETE'
    AND q.verified_at >= now() - interval '120 seconds';
`

async function registerMetadata() {
  if (metadata.status !== 'SHADOW_ONLY_CANDIDATE' || metadata.pipeline_catalog_published !== false ||
      metadata.contract_id !== 'reference.medusa.order_recorded_state.v2' ||
      metadata.coverage_epoch_id !== epoch || metadata.historical_gap_status !== 'INCOMPLETE' ||
      metadata.asset?.relation !== 'public.recovery_order_current_state_readable' ||
      metadata.asset?.grain?.join('|') !== 'coverage_epoch_id|source_instance_id|order_id') {
    throw Error('recovery metadata scope or version differs')
  }
  const columns = await pool.query(`SELECT column_name,data_type FROM information_schema.columns
    WHERE table_schema='public' AND table_name='recovery_order_current_state_readable'`)
  const actual = new Map(columns.rows.map(row => [row.column_name, row.data_type]))
  for (const [column, type] of Object.entries(metadata.asset.required_columns)) {
    if (actual.get(column) !== type) throw Error(`missing recovery physical column: ${column}`)
  }
  const content = JSON.stringify(metadata)
  const digest = createHash('sha256').update(content).digest('hex')
  await pool.query(`INSERT INTO recovery_semantic_catalog(catalog_id,version,definition,sha256)
    VALUES($1,$2,$3::jsonb,$4) ON CONFLICT DO NOTHING`,
  [metadata.catalog_id, metadata.version, content, digest])
  const saved = await pool.query(`SELECT sha256 FROM recovery_semantic_catalog
    WHERE catalog_id=$1 AND version=$2`, [metadata.catalog_id, metadata.version])
  if (saved.rows[0]?.sha256 !== digest) throw Error('recovery metadata changed without version bump')
}

function validate(value) {
  if (!value || value.contract_id !== 'reference.medusa.order_recorded_state.v2' ||
      value.coverage_epoch_id !== epoch || value.source_instance_id !== sourceId ||
      value.historical_gap_status !== 'INCOMPLETE' ||
      value.coverage !== 'CURRENT_STATE_FROM_REBASELINE' ||
      value.quality !== 'REFERENCE_APPROXIMATE' ||
      !/^[0-9a-f]{64}$/.test(value.record_id ?? '') ||
      !['BASELINE', 'BASELINE_COMPLETE', 'STATE', 'TRANSITION', 'CORRECTION'].includes(value.record_type)) {
    throw Error('invalid recovery record contract')
  }
  if (value.record_type === 'BASELINE_COMPLETE') {
    if (value.order_id !== '__baseline__' || !Number.isSafeInteger(value.baseline_orders) ||
        !Number.isSafeInteger(value.baseline_active_orders) ||
        !/^[0-9a-f]{64}$/.test(value.baseline_digest ?? '')) {
      throw Error('invalid recovery baseline completion marker')
    }
  } else if (!/^order_[A-Za-z0-9]+$/.test(value.order_id ?? '') ||
      typeof value.active !== 'boolean' ||
      (value.cart_id !== null && !/^cart_[A-Za-z0-9]+$/.test(value.cart_id ?? '')) ||
      (value.active && !value.cart_id) ||
      (value.record_type === 'BASELINE' ? value.revision_end_id !== null
        : !/^\d+:\d+$/.test(value.revision_end_id ?? ''))) {
    throw Error('invalid recovery state record')
  }
  return value
}

async function persist({ topic: inputTopic, partition, message }) {
  if (inputTopic !== topic || partition !== 0) throw Error('foreign recovery sink topic')
  const offset = BigInt(message.offset)
  const value = validate(JSON.parse(message.value?.toString('utf8') ?? 'null'))
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const saved = await client.query(`SELECT next_offset FROM recovery_sink_offsets
      WHERE topic=$1 AND partition=$2 FOR UPDATE`, [inputTopic, partition])
    const expected = BigInt(saved.rows[0]?.next_offset ?? 0)
    if (offset > expected) throw Error('recovery sink offset gap')
    if (offset === expected) {
      const inserted = await client.query(`INSERT INTO recovery_record_inbox
        (record_id,coverage_epoch_id,source_instance_id,order_id,record_type,payload,kafka_partition,kafka_offset)
        VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8)
        ON CONFLICT(record_id) DO NOTHING RETURNING record_id`,
      [value.record_id, epoch, sourceId, value.order_id, value.record_type,
        JSON.stringify(value), partition, message.offset])
      if (!inserted.rowCount) {
        const prior = await client.query(`SELECT payload=$2::jsonb AS same
          FROM recovery_record_inbox WHERE record_id=$1`, [value.record_id, JSON.stringify(value)])
        if (!prior.rows[0]?.same) throw Error('conflicting recovery record ID')
      } else if (value.record_type === 'BASELINE_COMPLETE') {
        const count = await client.query(`SELECT count(*)::integer AS rows,
          count(*) FILTER(WHERE active)::integer AS active
          FROM recovery_order_current_state WHERE coverage_epoch_id=$1`, [epoch])
        if (count.rows[0].rows !== value.baseline_orders ||
            count.rows[0].active !== value.baseline_active_orders) {
          throw Error('recovery sink baseline count differs from completion marker')
        }
        await client.query(`UPDATE recovery_quality_state SET baseline_complete=true,
          baseline_orders=$2,baseline_active_orders=$3,baseline_digest=$4,
          reason='BASELINE_CAPTURED_PENDING_SOURCE_RECONCILIATION'
          WHERE coverage_epoch_id=$1 AND status='BLOCKED_BY_QUALITY'`,
        [epoch, value.baseline_orders, value.baseline_active_orders, value.baseline_digest])
      } else {
        const quality = await client.query(`SELECT baseline_complete FROM recovery_quality_state
          WHERE coverage_epoch_id=$1 FOR UPDATE`, [epoch])
        if (quality.rows[0]?.baseline_complete && value.record_type === 'BASELINE') {
          throw Error('late recovery baseline row after completion marker')
        }
        if (!quality.rows[0]?.baseline_complete && value.record_type !== 'BASELINE') {
          throw Error('transition before recovery baseline completion')
        }
        const prior = await client.query(`SELECT active,cart_id,last_topic_offset
          FROM recovery_order_current_state WHERE coverage_epoch_id=$1
          AND source_instance_id=$2 AND order_id=$3 FOR UPDATE`,
        [epoch, sourceId, value.order_id])
        const previous = prior.rows[0]
        if (value.record_type === 'BASELINE' ? Boolean(previous)
          : value.record_type === 'TRANSITION' ?
            (previous && previous.active === value.active)
            : value.record_type === 'STATE' ? Boolean(previous) || value.active
              : !previous || previous.active !== value.active || previous.cart_id === value.cart_id) {
          throw Error('invalid recovery state transition ordering')
        }
        await client.query(`INSERT INTO recovery_order_current_state
          (coverage_epoch_id,source_instance_id,order_id,cart_id,active,last_record_id,last_topic_offset)
          VALUES($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT(coverage_epoch_id,source_instance_id,order_id) DO UPDATE SET
          cart_id=EXCLUDED.cart_id,active=EXCLUDED.active,last_record_id=EXCLUDED.last_record_id,
          last_topic_offset=EXCLUDED.last_topic_offset,updated_at=now()`,
        [epoch, sourceId, value.order_id, value.cart_id, value.active,
          value.record_id, message.offset])
        if (value.record_type !== 'BASELINE') {
          await client.query(`UPDATE recovery_quality_state SET
            status='BLOCKED_BY_QUALITY',reason='NEW_SOURCE_CHANGE_PENDING_RECONCILIATION',
            verified_at=NULL WHERE coverage_epoch_id=$1`, [epoch])
        }
      }
      await client.query(`INSERT INTO recovery_sink_offsets(topic,partition,next_offset)
        VALUES($1,$2,$3) ON CONFLICT(topic,partition)
        DO UPDATE SET next_offset=EXCLUDED.next_offset`,
      [inputTopic, partition, (offset + 1n).toString()])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally { client.release() }
  await consumer.commitOffsets([{ topic: inputTopic, partition, offset: (offset + 1n).toString() }])
}

let stopping = false
let resolveShutdown
const shutdown = new Promise(resolve => { resolveShutdown = resolve })
const crash = new Promise((_, reject) => consumer.on(consumer.events.CRASH,
  event => reject(event.payload.error)))
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
  await pool.query(`INSERT INTO recovery_quality_state
    (coverage_epoch_id,status,historical_gap_status,reason)
    VALUES($1,'BLOCKED_BY_QUALITY','INCOMPLETE','BASELINE_NOT_VERIFIED')
    ON CONFLICT DO NOTHING`, [epoch])
  await registerMetadata()
  await consumer.connect()
  await consumer.subscribe({ topic, fromBeginning: true })
  console.info(JSON.stringify({ service: 'reference-recovery-analytics', status: 'READY', epoch }))
  await consumer.run({ autoCommit: false, partitionsConsumedConcurrently: 1,
    eachMessage: persist })
  await Promise.race([shutdown, crash])
} catch (error) {
  console.error(JSON.stringify({ service: 'reference-recovery-analytics', code: 'FATAL',
    message: String(error.message).slice(0, 180) }))
  process.exitCode = 1
  await stop()
}
