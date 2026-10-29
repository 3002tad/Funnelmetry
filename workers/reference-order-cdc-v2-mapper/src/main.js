import { createHash } from 'node:crypto'
import pg from 'pg'
import { Kafka, logLevel } from 'kafkajs'

const epoch = process.env.COVERAGE_EPOCH_ID
const previousEpoch = process.env.PREVIOUS_COVERAGE_EPOCH_ID
const prefix = process.env.SOURCE_TOPIC_PREFIX
const factTopic = process.env.FACT_TOPIC
const sourceId = process.env.SOURCE_INSTANCE_ID
const groupId = process.env.KAFKA_GROUP_ID
const brokers = (process.env.KAFKA_BROKERS ?? '').split(',').filter(Boolean)
const tables = ['order', 'order_cart', 'cart']
const rowTopics = new Map(tables.map(table => [`${prefix}.public.${table}`, table]))
const transactionTopic = `${prefix}.transaction`
const dbUrl = process.env.DATABASE_URL
if (process.env.REFERENCE_CDC_MODE !== 'SHADOW_ONLY' || !dbUrl ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(epoch ?? '') ||
    !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(previousEpoch ?? '') ||
    previousEpoch === epoch ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(prefix ?? '') ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(factTopic ?? '') ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,199}$/.test(sourceId ?? '') ||
    !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(groupId ?? '') ||
    brokers.length !== 1 || !brokers[0] ||
    factTopic.startsWith(prefix + '.')) {
  throw Error('reference_cdc_v2_mapper_configuration_invalid')
}
const pool = new pg.Pool({ connectionString: dbUrl, max: 3, connectionTimeoutMillis: 10000 })
const kafka = new Kafka({ clientId: `reference-cdc-v2-mapper-${epoch}`, brokers,
  logLevel: logLevel.ERROR, retry: { retries: 3 } })
const consumer = kafka.consumer({ groupId, readUncommitted: false })
const producer = kafka.producer({ allowAutoTopicCreation: false })



const fields = {
  order: ['id', 'deleted_at'],
  order_cart: ['id', 'order_id', 'cart_id'],
  cart: ['id', 'completed_at'],
}
function rowEnvelope(table, value) {
  if (value === null) return null // Debezium delete tombstone
  if (!value || !['r', 'c', 'u', 'd'].includes(value.op)) throw Error('invalid recovery CDC op')
  const source = value.source ?? {}
  if (source.name !== prefix || source.db !== 'medusa' || source.schema !== 'public' ||
      source.table !== table || (source.lsn != null && !Number.isSafeInteger(source.lsn))) {
    throw Error('foreign recovery CDC source')
  }
  const snapshot = value.op === 'r'
  if (snapshot ? ![true, 'true', 'first', 'first_in_data_collection',
    'last_in_data_collection', 'last'].includes(source.snapshot)
    : ![false, 'false', null, undefined].includes(source.snapshot)) {
    throw Error('invalid snapshot marker in recovery CDC row')
  }
  if (!snapshot && (!Number.isSafeInteger(source.txId) || !Number.isSafeInteger(source.lsn) ||
      !Number.isSafeInteger(value.transaction?.total_order))) {
    throw Error('stream row has no safe transaction position')
  }
  const row = value.op === 'd' ? value.before : value.after
  if (!row || typeof row.id !== 'string' || !row.id ||
      (value.op !== 'd' && (Object.keys(row).length !== fields[table].length ||
        fields[table].some(field => !(field in row)))) ||
      Object.keys(row).some(field => !fields[table].includes(field))) {
    throw Error('recovery row differs from exact three-table allowlist')
  }
  const project = data => data == null ? null
    : Object.fromEntries(fields[table].map(field => [field, data[field] ?? null]))
  return { op: value.op, table, id: row.id, before: project(value.before),
    after: project(value.after), snapshot, marker: source.snapshot,
    txid: source.txId ?? null, lsn: source.lsn ?? null,
    totalOrder: value.transaction?.total_order ?? null }
}

function endEnvelope(value) {
  if (value === null || value?.status !== 'END') return null
  if (!/^\d+:\d+$/.test(String(value.id))) throw Error('invalid recovery END ID')
  const txid = Number(String(value.id).split(':', 1)[0])
  if (!Number.isSafeInteger(txid)) throw Error('unsafe recovery END txid')
  const expected = Object.fromEntries(tables.map(table => [table, (value.data_collections ?? [])
    .filter(item => item.data_collection === `public.${table}`)
    .reduce((sum, item) => sum + item.event_count, 0)]))
  if (Object.values(expected).some(count => !Number.isSafeInteger(count) || count < 0)) {
    throw Error('invalid recovery END row count')
  }
  return { txid, endId: value.id, expected, tsMs: value.ts_ms ?? null }
}

async function applyRow(client, table, payload) {
  const row = payload.op === 'd' ? payload.before : payload.after
  if (table === 'order') {
    if (payload.op === 'd') await client.query('DELETE FROM reference_cdc_v2_source_orders WHERE id=$1', [row.id])
    else await client.query(`INSERT INTO reference_cdc_v2_source_orders(id,present) VALUES($1,$2)
      ON CONFLICT(id) DO UPDATE SET present=EXCLUDED.present`, [row.id, row.deleted_at == null])
  } else if (table === 'cart') {
    if (payload.op === 'd') await client.query('DELETE FROM reference_cdc_v2_source_carts WHERE id=$1', [row.id])
    else await client.query(`INSERT INTO reference_cdc_v2_source_carts(id,completed) VALUES($1,$2)
      ON CONFLICT(id) DO UPDATE SET completed=EXCLUDED.completed`, [row.id, row.completed_at != null])
  } else if (payload.op === 'd') {
    await client.query('DELETE FROM reference_cdc_v2_source_links WHERE id=$1', [row.id])
  } else {
    if (!row.order_id || !row.cart_id) throw Error('incomplete recovery order-cart link')
    await client.query(`INSERT INTO reference_cdc_v2_source_links(id,order_id,cart_id) VALUES($1,$2,$3)
      ON CONFLICT(id) DO UPDATE SET order_id=EXCLUDED.order_id,cart_id=EXCLUDED.cart_id`,
    [row.id, row.order_id, row.cart_id])
  }
}

async function persistInput({ topic, partition, message }) {
  if (partition !== 0 || (topic !== transactionTopic && !rowTopics.has(topic))) {
    throw Error('unexpected recovery topic or partition')
  }
  const offset = BigInt(message.offset)
  const value = message.value === null ? null : JSON.parse(message.value.toString('utf8'))
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const saved = await client.query(`SELECT next_offset FROM reference_cdc_v2_input_offsets
      WHERE topic=$1 AND partition=$2 FOR UPDATE`, [topic, partition])
    const expected = BigInt(saved.rows[0]?.next_offset ?? 0)
    if (offset > expected) throw Error('recovery input offset gap')
    if (offset === expected) {
      if (topic === transactionTopic) {
        const end = endEnvelope(value)
        if (end) {
          await client.query(`INSERT INTO reference_cdc_v2_ends(txid,topic_offset,end_id,expected,source_ts_ms)
            VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(txid) DO NOTHING`,
          [end.txid, message.offset, end.endId, JSON.stringify(end.expected), end.tsMs])
          const prior = await client.query('SELECT end_id,expected FROM reference_cdc_v2_ends WHERE txid=$1', [end.txid])
          if (prior.rows[0]?.end_id !== end.endId || tables.some(
            table => prior.rows[0]?.expected?.[table] !== end.expected[table])) {
            throw Error('conflicting recovery END identity')
          }
        }
      } else {
        const table = rowTopics.get(topic)
        const row = rowEnvelope(table, value)
        if (row?.snapshot) {
          const epochStatus = await client.query(
            'SELECT status FROM reference_cdc_v2_epochs WHERE coverage_epoch_id=$1 FOR UPDATE', [epoch])
          if (epochStatus.rows[0]?.status !== 'BASELINING') {
            throw Error('snapshot record after baseline activation')
          }
          const payload = { op: 'r', before: null, after: row.after }
          await client.query(`INSERT INTO reference_cdc_v2_snapshot_rows
            (topic,partition,kafka_offset,table_name,row_id,payload)
            VALUES($1,$2,$3,$4,$5,$6::jsonb)
            ON CONFLICT(table_name,row_id) DO NOTHING`,
          [topic, partition, message.offset, table, row.id, JSON.stringify(payload)])
          const savedSnapshot = await client.query(`SELECT payload=$3::jsonb AS same
            FROM reference_cdc_v2_snapshot_rows WHERE table_name=$1 AND row_id=$2`,
          [table, row.id, JSON.stringify(payload)])
          if (!savedSnapshot.rows[0]?.same) {
            throw Error('snapshot retry changed a previously captured row; new epoch required')
          }
          await applyRow(client, table, payload)
          if (row.marker === 'last') await client.query(`UPDATE reference_cdc_v2_epochs
            SET snapshot_last_seen=true,updated_at=now() WHERE coverage_epoch_id=$1`, [epoch])
        } else if (row) {
          const key = [epoch, prefix, table, row.txid, row.lsn, row.totalOrder].join(':')
          const payload = { op: row.op, before: row.before, after: row.after }
          await client.query(`INSERT INTO reference_cdc_v2_stream_rows
            (event_key,txid,table_name,total_order,lsn,payload)
            VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(event_key) DO NOTHING`,
          [key, row.txid, table, row.totalOrder, row.lsn, JSON.stringify(payload)])
          const prior = await client.query(`SELECT payload=$2::jsonb AS same
            FROM reference_cdc_v2_stream_rows WHERE event_key=$1`, [key, JSON.stringify(payload)])
          if (!prior.rows[0]?.same) throw Error('conflicting recovery stream identity')
        }
      }
      await client.query(`INSERT INTO reference_cdc_v2_input_offsets(topic,partition,next_offset)
        VALUES($1,$2,$3) ON CONFLICT(topic,partition)
        DO UPDATE SET next_offset=EXCLUDED.next_offset`,
      [topic, partition, (offset + 1n).toString()])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally { client.release() }
  await consumer.commitOffsets([{ topic, partition, offset: (offset + 1n).toString() }])
}

async function persistSnapshotBatch(batch) {
  const { topic, partition, messages } = batch
  if (partition !== 0 || !rowTopics.has(topic) || !messages.length) return false
  const table = rowTopics.get(topic)
  const decoded = messages.map(message => {
    if (message.value === null) return null
    return rowEnvelope(table, JSON.parse(message.value.toString('utf8')))
  })
  if (decoded.some(row => !row?.snapshot)) return false
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const saved = await client.query(`SELECT next_offset FROM reference_cdc_v2_input_offsets
      WHERE topic=$1 AND partition=$2 FOR UPDATE`, [topic, partition])
    const expected = BigInt(saved.rows[0]?.next_offset ?? 0)
    const fresh = messages.map((message, index) => ({ message, row: decoded[index] }))
      .filter(({ message }) => BigInt(message.offset) >= expected)
    if (!fresh.length) {
      await client.query('COMMIT')
      await consumer.commitOffsets([{ topic, partition,
        offset: (BigInt(messages.at(-1).offset) + 1n).toString() }])
      return true
    }
    const status = await client.query(
      'SELECT status FROM reference_cdc_v2_epochs WHERE coverage_epoch_id=$1 FOR UPDATE', [epoch])
    if (status.rows[0]?.status !== 'BASELINING') {
      throw Error('new snapshot batch after baseline activation')
    }
    if (BigInt(fresh[0].message.offset) !== expected || fresh.some((entry, index) =>
      BigInt(entry.message.offset) !== expected + BigInt(index))) {
      throw Error('snapshot batch offset gap')
    }
    const rows = fresh.map(({ message, row }) => ({
      kafka_offset: message.offset, row_id: row.id,
      payload: { op: 'r', before: null, after: row.after },
    }))
    const encoded = JSON.stringify(rows)
    await client.query(`WITH incoming AS (
      SELECT * FROM jsonb_to_recordset($4::jsonb)
        AS x(kafka_offset bigint,row_id text,payload jsonb))
      INSERT INTO reference_cdc_v2_snapshot_rows(topic,partition,kafka_offset,table_name,row_id,payload)
      SELECT $1,$2,kafka_offset,$3,row_id,payload FROM incoming
      ON CONFLICT(table_name,row_id) DO NOTHING`,
    [topic, partition, table, encoded])
    const conflict = await client.query(`WITH incoming AS (
      SELECT * FROM jsonb_to_recordset($2::jsonb)
        AS x(kafka_offset bigint,row_id text,payload jsonb))
      SELECT count(*)::integer AS n FROM incoming i
      JOIN reference_cdc_v2_snapshot_rows s ON s.table_name=$1 AND s.row_id=i.row_id
      WHERE s.payload<>i.payload`, [table, encoded])
    if (conflict.rows[0].n) {
      throw Error('snapshot retry changed a previously captured row; new epoch required')
    }
    const sourceTable = table === 'order' ? 'reference_cdc_v2_source_orders'
      : table === 'cart' ? 'reference_cdc_v2_source_carts' : 'reference_cdc_v2_source_links'
    const incoming = `WITH incoming AS (
      SELECT DISTINCT ON (row_id) row_id,payload FROM jsonb_to_recordset($1::jsonb)
        AS x(kafka_offset bigint,row_id text,payload jsonb)
      ORDER BY row_id,kafka_offset DESC)`
    if (table === 'order') {
      await client.query(`${incoming} INSERT INTO ${sourceTable}(id,present)
        SELECT row_id,payload->'after'->>'deleted_at' IS NULL FROM incoming
        ON CONFLICT(id) DO UPDATE SET present=EXCLUDED.present`, [encoded])
    } else if (table === 'cart') {
      await client.query(`${incoming} INSERT INTO ${sourceTable}(id,completed)
        SELECT row_id,payload->'after'->>'completed_at' IS NOT NULL FROM incoming
        ON CONFLICT(id) DO UPDATE SET completed=EXCLUDED.completed`, [encoded])
    } else {
      await client.query(`${incoming} INSERT INTO ${sourceTable}(id,order_id,cart_id)
        SELECT row_id,payload->'after'->>'order_id',payload->'after'->>'cart_id'
        FROM incoming ON CONFLICT(id) DO UPDATE SET
        order_id=EXCLUDED.order_id,cart_id=EXCLUDED.cart_id`, [encoded])
    }
    if (fresh.some(({ row }) => row.marker === 'last')) {
      await client.query(`UPDATE reference_cdc_v2_epochs SET snapshot_last_seen=true,updated_at=now()
        WHERE coverage_epoch_id=$1`, [epoch])
    }
    await client.query(`INSERT INTO reference_cdc_v2_input_offsets(topic,partition,next_offset)
      VALUES($1,$2,$3) ON CONFLICT(topic,partition)
      DO UPDATE SET next_offset=EXCLUDED.next_offset`,
    [topic, partition, (BigInt(fresh.at(-1).message.offset) + 1n).toString()])
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally { client.release() }
  await consumer.commitOffsets([{ topic, partition,
    offset: (BigInt(messages.at(-1).offset) + 1n).toString() }])
  return true
}

async function updateStates(client, end, candidateIds) {
  for (const orderId of [...candidateIds].sort()) {
    const current = await client.query(`SELECT l.cart_id FROM reference_cdc_v2_source_links l
      JOIN reference_cdc_v2_source_carts c ON c.id=l.cart_id AND c.completed
      JOIN reference_cdc_v2_source_orders o ON o.id=l.order_id AND o.present
      WHERE l.order_id=$1 ORDER BY l.cart_id`, [orderId])
    const carts = [...new Set(current.rows.map(row => row.cart_id))]
    if (carts.length > 1) throw Error('multiple eligible carts in recovery state')
    const active = carts.length === 1
    const prior = await client.query('SELECT active,cart_id FROM reference_cdc_v2_state WHERE order_id=$1', [orderId])
    const previous = prior.rows[0]
    const cartId = active ? carts[0] : previous?.cart_id ?? null
    const recordType = !previous && !active ? 'STATE'
      : !previous || previous.active !== active ? 'TRANSITION'
        : previous.cart_id !== cartId ? 'CORRECTION' : null
    if (!recordType) continue
    const recordId = createHash('sha256').update(
      `${epoch}|${sourceId}|${orderId}|${end.end_id}|${recordType}|${active}|${cartId ?? ''}`,
    ).digest('hex')
    const payload = {
      contract_id: 'reference.medusa.order_recorded_state.v2',
      coverage_epoch_id: epoch, historical_gap_status: 'INCOMPLETE',
      coverage: 'CURRENT_STATE_FROM_REBASELINE', quality: 'REFERENCE_APPROXIMATE',
      source_instance_id: sourceId, record_id: recordId, record_type: recordType,
      order_id: orderId, cart_id: cartId, active, revision_end_id: end.end_id,
      observed_state_at: end.source_ts_ms == null ? null
        : new Date(Number(end.source_ts_ms)).toISOString(),
    }
    await client.query(`INSERT INTO reference_cdc_v2_state(order_id,active,cart_id,last_revision)
      VALUES($1,$2,$3,$4) ON CONFLICT(order_id) DO UPDATE SET
      active=EXCLUDED.active,cart_id=EXCLUDED.cart_id,
      last_revision=EXCLUDED.last_revision,updated_at=now()`,
    [orderId, active, cartId, end.end_id])
    await client.query(`INSERT INTO reference_cdc_v2_outbox(record_id,order_id,record_type,payload)
      VALUES($1,$2,$3,$4::jsonb) ON CONFLICT(record_id) DO NOTHING`,
    [recordId, orderId, recordType, JSON.stringify(payload)])
  }
}

async function processReady() {
  const status = await pool.query('SELECT status FROM reference_cdc_v2_epochs WHERE coverage_epoch_id=$1', [epoch])
  if (status.rows[0]?.status !== 'BASELINE_VERIFIED') return
  while (true) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query(`SELECT txid,end_id,expected,source_ts_ms
        FROM reference_cdc_v2_ends WHERE processed_at IS NULL ORDER BY topic_offset LIMIT 1 FOR UPDATE`)
      const end = result.rows[0]
      if (!end) { await client.query('COMMIT'); break }
      const counts = await client.query(`SELECT table_name,count(*)::integer AS count
        FROM reference_cdc_v2_stream_rows WHERE txid=$1 GROUP BY table_name`, [end.txid])
      const actual = Object.fromEntries(counts.rows.map(row => [row.table_name, row.count]))
      if (tables.some(table => (actual[table] ?? 0) > end.expected[table])) {
        throw Error('recovery END has excess row records')
      }
      if (tables.some(table => (actual[table] ?? 0) !== end.expected[table])) {
        await client.query('COMMIT')
        break // do not pass a hole in the ordered transaction prefix
      }
      const rows = await client.query(`SELECT table_name,payload FROM reference_cdc_v2_stream_rows
        WHERE txid=$1 ORDER BY total_order,lsn,event_key`, [end.txid])
      const candidates = new Set()
      const changedCarts = new Set()
      for (const row of rows.rows) {
        const value = row.payload
        if (row.table_name === 'order') {
          if (value.before?.id) candidates.add(value.before.id)
          if (value.after?.id) candidates.add(value.after.id)
        } else if (row.table_name === 'order_cart') {
          if (value.before?.order_id) candidates.add(value.before.order_id)
          if (value.after?.order_id) candidates.add(value.after.order_id)
        } else if (row.table_name === 'cart') {
          if (value.before?.id) changedCarts.add(value.before.id)
          if (value.after?.id) changedCarts.add(value.after.id)
        }
      }
      for (const cartId of changedCarts) {
        const priorLinks = await client.query(
          'SELECT order_id FROM reference_cdc_v2_source_links WHERE cart_id=$1', [cartId])
        for (const link of priorLinks.rows) candidates.add(link.order_id)
      }
      for (const row of rows.rows) await applyRow(client, row.table_name, row.payload)
      for (const cartId of changedCarts) {
        const currentLinks = await client.query(
          'SELECT order_id FROM reference_cdc_v2_source_links WHERE cart_id=$1', [cartId])
        for (const link of currentLinks.rows) candidates.add(link.order_id)
      }
      await updateStates(client, end, candidates)
      await client.query('UPDATE reference_cdc_v2_ends SET processed_at=now() WHERE txid=$1', [end.txid])
      await client.query(`UPDATE reference_cdc_v2_epochs SET last_processed_end_id=$2,updated_at=now()
        WHERE coverage_epoch_id=$1`, [epoch, end.end_id])
      await client.query('COMMIT')
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally { client.release() }
  }
}

async function publishPending() {
  const status = await pool.query('SELECT status FROM reference_cdc_v2_epochs WHERE coverage_epoch_id=$1', [epoch])
  if (status.rows[0]?.status !== 'BASELINE_VERIFIED') return
  while (true) {
    const next = await pool.query(`SELECT seq,order_id,payload FROM reference_cdc_v2_outbox
      WHERE published_at IS NULL ORDER BY seq LIMIT 1`)
    if (!next.rows.length) return
    const row = next.rows[0]
    await producer.send({ topic: factTopic, messages: [{
      key: `${epoch}:${sourceId}:${row.order_id}`, value: JSON.stringify(row.payload),
    }] })
    await pool.query(`UPDATE reference_cdc_v2_outbox SET published_at=now()
      WHERE seq=$1 AND published_at IS NULL`, [row.seq])
  }
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
  await Promise.allSettled([consumer.disconnect(), producer.disconnect()])
  await pool.end()
  resolveShutdown()
}
process.once('SIGTERM', () => { void stop() })
process.once('SIGINT', () => { void stop() })

try {
  const installed = await pool.query(`SELECT
    to_regclass('public.reference_cdc_v2_epochs') IS NOT NULL AS epochs,
    to_regclass('public.reference_cdc_v2_outbox') IS NOT NULL AS outbox`)
  if (!installed.rows[0]?.epochs || !installed.rows[0]?.outbox) {
    throw Error('reference_cdc_v2_mapper_schema_missing')
  }
  const foreign = await pool.query(`SELECT count(*)::integer AS n
    FROM reference_cdc_v2_epochs WHERE coverage_epoch_id <> $1`, [epoch])
  if (foreign.rows[0]?.n !== 0) throw Error('mapper_database_contains_another_coverage_epoch')
  await pool.query(`INSERT INTO reference_cdc_v2_epochs
    (coverage_epoch_id,previous_epoch_id,previous_epoch_gap,source_prefix,fact_topic,status)
    VALUES($1,$2,'INCOMPLETE',$3,$4,'BASELINING') ON CONFLICT DO NOTHING`,
  [epoch, previousEpoch, prefix, factTopic])
  const saved = await pool.query(`SELECT * FROM reference_cdc_v2_epochs WHERE coverage_epoch_id=$1`, [epoch])
  if (saved.rows[0]?.previous_epoch_id !== previousEpoch ||
      saved.rows[0]?.previous_epoch_gap !== 'INCOMPLETE' ||
      saved.rows[0]?.source_prefix !== prefix || saved.rows[0]?.fact_topic !== factTopic ||
      saved.rows[0]?.status === 'BLOCKED_BY_QUALITY') {
    throw Error('recovery epoch ownership or quality state differs')
  }
  await producer.connect()
  await consumer.connect()
  for (const topic of [...rowTopics.keys(), transactionTopic]) {
    await consumer.subscribe({ topic, fromBeginning: true })
  }
  await processReady()
  await publishPending()
  console.info(JSON.stringify({ service: 'reference-order-cdc-v2-mapper',
    status: 'READY', epoch, source_instance_id: sourceId, scope: 'SHADOW_ONLY' }))
  await consumer.run({ autoCommit: false, partitionsConsumedConcurrently: 1,
    eachBatchAutoResolve: false,
    eachBatch: async ({ batch, heartbeat, resolveOffset }) => {
      if (await persistSnapshotBatch(batch)) {
        for (const message of batch.messages) resolveOffset(message.offset)
        await heartbeat()
        return
      }
      for (const message of batch.messages) {
        await persistInput({ topic: batch.topic, partition: batch.partition, message })
        resolveOffset(message.offset)
        await processReady()
        await publishPending()
      }
      await heartbeat()
    },
  })
  await Promise.race([shutdown, crash])
} catch (error) {
  console.error(JSON.stringify({ service: 'reference-order-cdc-v2-mapper', code: 'FATAL',
    message: String(error.message).slice(0, 180) }))
  process.exitCode = 1
  await stop()
}
