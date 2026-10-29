import pg from 'pg'
import { Kafka, logLevel } from 'kafkajs'
import { validateRecord } from './contract.js'

const epoch = process.env.COVERAGE_EPOCH_ID
const sourceId = process.env.SOURCE_INSTANCE_ID
const topic = process.env.FACT_TOPIC
const groupId = process.env.KAFKA_GROUP_ID
const brokers = (process.env.KAFKA_BROKERS ?? '').split(',').filter(Boolean)
const url = process.env.DATABASE_URL
if (process.env.REFERENCE_CDC_MODE !== 'SHADOW_ONLY' || !url ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(epoch ?? '') ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(sourceId ?? '') ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(topic ?? '') ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(groupId ?? '') ||
    brokers.length !== 1 || !brokers[0]) {
  throw Error('reference_cdc_v2_sink_configuration_invalid')
}
const pool = new pg.Pool({ connectionString: url, max: 3, connectionTimeoutMillis: 10000 })
const kafka = new Kafka({ clientId: `reference-cdc-v2-sink-${epoch}`, brokers,
  logLevel: logLevel.ERROR, retry: { retries: 3 } })
const consumer = kafka.consumer({ groupId, readUncommitted: false })

async function persist({ topic: inputTopic, partition, message }) {
  if (inputTopic !== topic || partition !== 0) throw Error('foreign recovery sink topic')
  const offset = BigInt(message.offset)
  const value = validateRecord(JSON.parse(message.value?.toString('utf8') ?? 'null'),
    {epoch, sourceId})
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const saved = await client.query(`SELECT next_offset FROM reference_cdc_v2_sink_offsets
      WHERE fact_topic=$1 AND partition=$2 FOR UPDATE`, [inputTopic, partition])
    const expected = BigInt(saved.rows[0]?.next_offset ?? 0)
    if (offset > expected) throw Error('recovery sink offset gap')
    if (offset === expected) {
      const inserted = await client.query(`INSERT INTO reference_cdc_v2_record_inbox
        (record_id,coverage_epoch_id,source_instance_id,fact_topic,order_id,record_type,payload,kafka_partition,kafka_offset)
        VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9)
        ON CONFLICT(record_id) DO NOTHING RETURNING record_id`,
      [value.record_id, epoch, sourceId, topic, value.order_id, value.record_type,
        JSON.stringify(value), partition, message.offset])
      if (!inserted.rowCount) {
        const prior = await client.query(`SELECT payload=$2::jsonb AS same
          FROM reference_cdc_v2_record_inbox WHERE record_id=$1`, [value.record_id, JSON.stringify(value)])
        if (!prior.rows[0]?.same) throw Error('conflicting recovery record ID')
      } else if (value.record_type === 'BASELINE_COMPLETE') {
        const count = await client.query(`SELECT count(*)::integer AS rows,
          count(*) FILTER(WHERE active)::integer AS active
          FROM reference_cdc_v2_order_current_state
          WHERE source_instance_id=$1 AND coverage_epoch_id=$2`, [sourceId, epoch])
        if (count.rows[0].rows !== value.baseline_orders ||
            count.rows[0].active !== value.baseline_active_orders) {
          throw Error('recovery sink baseline count differs from completion marker')
        }
        await client.query(`UPDATE reference_cdc_v2_quality_state SET baseline_complete=true,
          baseline_orders=$3,baseline_active_orders=$4,baseline_digest=$5,
          reason='BASELINE_CAPTURED_PENDING_SOURCE_RECONCILIATION'
          WHERE source_instance_id=$1 AND coverage_epoch_id=$2
            AND status='BLOCKED_BY_QUALITY'`,
        [sourceId, epoch, value.baseline_orders, value.baseline_active_orders,
          value.baseline_digest])
      } else {
        const quality = await client.query(`SELECT baseline_complete FROM reference_cdc_v2_quality_state
          WHERE source_instance_id=$1 AND coverage_epoch_id=$2 FOR UPDATE`, [sourceId, epoch])
        if (quality.rows[0]?.baseline_complete && value.record_type === 'BASELINE') {
          throw Error('late recovery baseline row after completion marker')
        }
        if (!quality.rows[0]?.baseline_complete && value.record_type !== 'BASELINE') {
          throw Error('transition before recovery baseline completion')
        }
        const prior = await client.query(`SELECT active,cart_id,last_topic_offset
          FROM reference_cdc_v2_order_current_state WHERE source_instance_id=$1
          AND coverage_epoch_id=$2 AND order_id=$3 FOR UPDATE`,
        [sourceId, epoch, value.order_id])
        const previous = prior.rows[0]
        if (value.record_type === 'BASELINE' ? Boolean(previous)
          : value.record_type === 'TRANSITION' ?
            (previous && previous.active === value.active)
            : value.record_type === 'STATE' ? Boolean(previous) || value.active
              : !previous || previous.active !== value.active || previous.cart_id === value.cart_id) {
          throw Error('invalid recovery state transition ordering')
        }
        await client.query(`INSERT INTO reference_cdc_v2_order_current_state
          (coverage_epoch_id,source_instance_id,order_id,cart_id,active,last_record_id,last_topic_offset)
          VALUES($1,$2,$3,$4,$5,$6,$7)
          ON CONFLICT(coverage_epoch_id,source_instance_id,order_id) DO UPDATE SET
          cart_id=EXCLUDED.cart_id,active=EXCLUDED.active,last_record_id=EXCLUDED.last_record_id,
          last_topic_offset=EXCLUDED.last_topic_offset,updated_at=now()`,
        [epoch, sourceId, value.order_id, value.cart_id, value.active,
          value.record_id, message.offset])
        if (value.record_type !== 'BASELINE') {
          await client.query(`UPDATE reference_cdc_v2_quality_state SET
            status='BLOCKED_BY_QUALITY',reason='NEW_SOURCE_CHANGE_PENDING_RECONCILIATION',
            verified_at=NULL,valid_until=NULL
            WHERE source_instance_id=$1 AND coverage_epoch_id=$2`, [sourceId, epoch])
        }
      }
      await client.query(`INSERT INTO reference_cdc_v2_sink_offsets(fact_topic,partition,next_offset)
        VALUES($1,$2,$3) ON CONFLICT(fact_topic,partition)
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
  const {rows} = await pool.query(`SELECT
    to_regclass('public.reference_cdc_v2_record_inbox') IS NOT NULL AS inbox,
    to_regclass('public.reference_cdc_v2_order_current_state_readable') IS NOT NULL AS readable`)
  if (!rows[0]?.inbox || !rows[0]?.readable) throw Error('reference_cdc_v2_schema_missing')
  await pool.query(`INSERT INTO reference_cdc_v2_quality_state
    (source_instance_id,coverage_epoch_id,status,historical_gap_status,reason)
    VALUES($1,$2,'BLOCKED_BY_QUALITY','INCOMPLETE','BASELINE_NOT_VERIFIED')
    ON CONFLICT DO NOTHING`, [sourceId, epoch])
  await consumer.connect()
  await consumer.subscribe({ topic, fromBeginning: true })
  console.info(JSON.stringify({ service: 'reference-order-cdc-v2-sink', status: 'READY',
    source_instance_id: sourceId, coverage_epoch_id: epoch, scope: 'SHADOW_ONLY' }))
  await consumer.run({ autoCommit: false, partitionsConsumedConcurrently: 1,
    eachMessage: persist })
  await Promise.race([shutdown, crash])
} catch (error) {
  console.error(JSON.stringify({ service: 'reference-order-cdc-v2-sink', code: 'FATAL',
    message: String(error.message).slice(0, 180) }))
  process.exitCode = 1
  await stop()
}
