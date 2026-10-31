import { createHash } from 'node:crypto'
import pg from 'pg'
import { Kafka, logLevel } from 'kafkajs'

// Isolated reference experiment. No live Pipeline topic, Medusa DB write, or
// canonical order.placed mapping is performed by this service.
const config = {
  databaseUrl: process.env.DATABASE_URL,
  brokers: (process.env.KAFKA_BROKERS ?? '').split(',').filter(Boolean),
  groupId: process.env.KAFKA_GROUP_ID,
  sourceInstanceId: process.env.SOURCE_INSTANCE_ID,
  factTopic: process.env.FACT_TOPIC,
  failCartId: process.env.SHADOW_FAIL_AFTER_INBOX_ONCE_FOR_CART_ID || null,
}
if (!config.databaseUrl || !config.brokers.length || !config.groupId || !config.sourceInstanceId || !config.factTopic) {
  throw Error('reference mapper configuration is incomplete')
}
if (config.failCartId && !/^cart_[A-Za-z0-9]+$/.test(config.failCartId)) throw Error('invalid shadow fault cart ID')

const rowTopics = new Map([
  ['cdc_shadow_medusa.public.order', 'order'],
  ['cdc_shadow_medusa.public.order_cart', 'order_cart'],
  ['cdc_shadow_medusa.public.cart', 'cart'],
])
const endTopic = 'cdc_shadow_medusa.transaction'
const tables = [...rowTopics.values()]
const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 3, connectionTimeoutMillis: 10000 })
const kafka = new Kafka({ clientId: 'cdc-shadow-reference-mapper', brokers: config.brokers,
  logLevel: logLevel.ERROR, retry: { retries: 3 } })
const consumer = kafka.consumer({ groupId: config.groupId, readUncommitted: false })
const producer = kafka.producer({ allowAutoTopicCreation: true })

const schema = `
CREATE TABLE IF NOT EXISTS cdc_rows (
  event_key text PRIMARY KEY, txid bigint NOT NULL, table_name text NOT NULL,
  total_order bigint NOT NULL, lsn bigint NOT NULL, payload jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS cdc_rows_txid ON cdc_rows(txid);
CREATE TABLE IF NOT EXISTS cdc_ends (
  txid bigint PRIMARY KEY, topic_offset bigint NOT NULL UNIQUE,
  end_id text NOT NULL, expected jsonb NOT NULL, source_ts_ms bigint,
  processed_at timestamptz
);
CREATE INDEX IF NOT EXISTS cdc_ends_pending ON cdc_ends(topic_offset) WHERE processed_at IS NULL;
CREATE TABLE IF NOT EXISTS cdc_input_offsets (
  topic text NOT NULL, partition integer NOT NULL, next_offset bigint NOT NULL,
  PRIMARY KEY(topic, partition)
);
CREATE TABLE IF NOT EXISTS source_orders (id text PRIMARY KEY, present boolean NOT NULL);
CREATE TABLE IF NOT EXISTS source_carts (id text PRIMARY KEY, completed boolean NOT NULL);
CREATE TABLE IF NOT EXISTS source_links (id text PRIMARY KEY, order_id text NOT NULL, cart_id text NOT NULL);
CREATE INDEX IF NOT EXISTS source_links_order ON source_links(order_id);
CREATE TABLE IF NOT EXISTS fact_state (
  order_id text PRIMARY KEY, active boolean NOT NULL, cart_id text,
  last_end_id text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fact_outbox (
  seq bigserial PRIMARY KEY, change_id text NOT NULL UNIQUE,
  order_id text NOT NULL, payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), published_at timestamptz
);
CREATE INDEX IF NOT EXISTS fact_outbox_unpublished ON fact_outbox(seq) WHERE published_at IS NULL;
CREATE TABLE IF NOT EXISTS fault_once (name text PRIMARY KEY, triggered_at timestamptz NOT NULL DEFAULT now());
`

function validatedRow(table, value) {
  if (!value || !['c', 'u', 'd'].includes(value.op)) return null // tombstone or heartbeat
  const source = value.source ?? {}
  const tx = value.transaction ?? {}
  if (source.name !== 'cdc_shadow_medusa' || source.db !== 'medusa' || source.schema !== 'public'
      || source.table !== table || ![false, 'false', null, undefined].includes(source.snapshot)
      || !Number.isSafeInteger(source.txId) || !Number.isSafeInteger(source.lsn)
      || !Number.isSafeInteger(tx.total_order)) throw Error('invalid shadow CDC row envelope')
  const row = value.op === 'd' ? value.before : value.after
  if (!row?.id) throw Error('shadow CDC row lacks ID')
  const eventKey = [source.name, source.db, source.schema, table,
    source.txId, source.lsn, tx.total_order].join(':')
  const fields = table === 'order' ? ['id', 'deleted_at']
    : table === 'cart' ? ['id', 'completed_at'] : ['id', 'order_id', 'cart_id']
  const project = data => data == null ? null
    : Object.fromEntries(fields.map(field => [field, data[field] ?? null]))
  return { eventKey, txid: source.txId, table, totalOrder: tx.total_order,
    lsn: source.lsn, op: value.op, before: project(value.before), after: project(value.after) }
}

function validatedEnd(value) {
  if (!value || value.status !== 'END') return null
  const txid = Number(String(value.id).split(':', 1)[0])
  if (!Number.isSafeInteger(txid) || !/^\d+:\d+$/.test(String(value.id))) throw Error('invalid CDC transaction END ID')
  const expected = Object.fromEntries(tables.map(table => [table,
    (value.data_collections ?? []).filter(item => item.data_collection === `public.${table}`)
      .reduce((sum, item) => sum + item.event_count, 0)]))
  if (Object.values(expected).some(count => !Number.isSafeInteger(count) || count < 0)) {
    throw Error('invalid CDC transaction row counts')
  }
  return { txid, endId: value.id, expected, sourceTsMs: value.ts_ms ?? null }
}

async function persistInput({ topic, partition, message }) {
  const client = await pool.connect()
  let failAfterCommit = false
  try {
    await client.query('BEGIN')
    const value = message.value === null ? null : JSON.parse(message.value.toString('utf8'))
    if (topic === endTopic) {
      const end = validatedEnd(value)
      if (end) {
        await client.query(`INSERT INTO cdc_ends(txid,topic_offset,end_id,expected,source_ts_ms)
          VALUES($1,$2,$3,$4::jsonb,$5) ON CONFLICT(txid) DO NOTHING`,
          [end.txid, message.offset, end.endId, JSON.stringify(end.expected), end.sourceTsMs])
        const saved = await client.query('SELECT end_id,expected FROM cdc_ends WHERE txid=$1', [end.txid])
        if (saved.rows[0]?.end_id !== end.endId ||
            tables.some(table => saved.rows[0]?.expected?.[table] !== end.expected[table])) {
          throw Error('conflicting CDC transaction END identity')
        }
      }
    } else {
      const table = rowTopics.get(topic)
      if (!table) throw Error('unexpected CDC topic')
      const row = validatedRow(table, value)
      if (row) {
        const payload = { op: row.op, before: row.before, after: row.after }
        await client.query(`INSERT INTO cdc_rows(event_key,txid,table_name,total_order,lsn,payload)
          VALUES($1,$2,$3,$4,$5,$6::jsonb) ON CONFLICT(event_key) DO NOTHING`,
          [row.eventKey, row.txid, row.table, row.totalOrder, row.lsn, JSON.stringify(payload)])
        const saved = await client.query('SELECT payload = $2::jsonb AS same FROM cdc_rows WHERE event_key=$1',
          [row.eventKey, JSON.stringify(payload)])
        if (!saved.rows[0]?.same) throw Error('conflicting CDC row identity')
        if (config.failCartId && table === 'cart' && row.after?.id === config.failCartId
            && row.after.completed_at != null) {
          const marker = await client.query(`INSERT INTO fault_once(name) VALUES('after-inbox-cart')
            ON CONFLICT DO NOTHING RETURNING name`)
          failAfterCommit = marker.rowCount === 1
        }
      }
    }
    await client.query(`INSERT INTO cdc_input_offsets(topic,partition,next_offset)
      VALUES($1,$2,$3) ON CONFLICT(topic,partition)
      DO UPDATE SET next_offset=GREATEST(cdc_input_offsets.next_offset,EXCLUDED.next_offset)`,
    [topic, partition, (BigInt(message.offset) + 1n).toString()])
    await client.query('COMMIT')
    return failAfterCommit
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {})
    throw error
  } finally {
    client.release()
  }
}

async function applyRow(client, table, payload) {
  const row = payload.op === 'd' ? payload.before : payload.after
  if (!row?.id) throw Error('CDC row ID is missing during projection')
  if (table === 'order') {
    if (payload.op === 'd') await client.query('DELETE FROM source_orders WHERE id=$1', [row.id])
    else await client.query(`INSERT INTO source_orders(id,present) VALUES($1,$2)
      ON CONFLICT(id) DO UPDATE SET present=EXCLUDED.present`, [row.id, row.deleted_at == null])
  } else if (table === 'cart') {
    if (payload.op === 'd') await client.query('DELETE FROM source_carts WHERE id=$1', [row.id])
    else await client.query(`INSERT INTO source_carts(id,completed) VALUES($1,$2)
      ON CONFLICT(id) DO UPDATE SET completed=EXCLUDED.completed`, [row.id, row.completed_at != null])
  } else {
    if (payload.op === 'd') await client.query('DELETE FROM source_links WHERE id=$1', [row.id])
    else {
      if (!row.order_id || !row.cart_id) throw Error('order_cart link is incomplete')
      await client.query(`INSERT INTO source_links(id,order_id,cart_id) VALUES($1,$2,$3)
        ON CONFLICT(id) DO UPDATE SET order_id=EXCLUDED.order_id,cart_id=EXCLUDED.cart_id`,
      [row.id, row.order_id, row.cart_id])
    }
  }
}

async function updateFacts(client, end) {
  const candidates = await client.query(`SELECT id AS order_id FROM source_orders
    UNION SELECT order_id FROM source_links
    UNION SELECT order_id FROM fact_state ORDER BY order_id`)
  for (const candidate of candidates.rows) {
    const orderId = candidate.order_id
    const eligible = await client.query(`SELECT l.cart_id FROM source_links l
      JOIN source_carts c ON c.id=l.cart_id AND c.completed
      JOIN source_orders o ON o.id=l.order_id AND o.present
      WHERE l.order_id=$1 ORDER BY l.cart_id`, [orderId])
    const distinctCarts = [...new Set(eligible.rows.map(row => row.cart_id))]
    if (distinctCarts.length > 1) throw Error('multiple eligible carts for one order')
    const active = distinctCarts.length === 1
    const previous = await client.query('SELECT active,cart_id FROM fact_state WHERE order_id=$1', [orderId])
    if (active === (previous.rows[0]?.active ?? false)) continue
    const cartId = active ? distinctCarts[0] : previous.rows[0]?.cart_id ?? null
    const changeId = createHash('sha256').update(
      `${config.sourceInstanceId}|${orderId}|${end.end_id}|${active ? 'ON' : 'OFF'}`,
    ).digest('hex')
    const fact = {
      contract_id: 'reference.medusa.order_recorded_state.v1',
      source_instance_id: config.sourceInstanceId,
      fact_change_id: changeId,
      order_id: orderId,
      cart_id: cartId,
      active,
      revision_end_id: end.end_id,
      observed_state_at: end.source_ts_ms == null ? null : new Date(Number(end.source_ts_ms)).toISOString(),
      quality: 'REFERENCE_APPROXIMATE',
      coverage: 'POST_ACTIVATION_ONLY',
    }
    await client.query(`INSERT INTO fact_state(order_id,active,cart_id,last_end_id)
      VALUES($1,$2,$3,$4) ON CONFLICT(order_id)
      DO UPDATE SET active=EXCLUDED.active,cart_id=EXCLUDED.cart_id,
        last_end_id=EXCLUDED.last_end_id,updated_at=now()`,
    [orderId, active, cartId, end.end_id])
    await client.query(`INSERT INTO fact_outbox(change_id,order_id,payload)
      VALUES($1,$2,$3::jsonb) ON CONFLICT(change_id) DO NOTHING`,
    [changeId, orderId, JSON.stringify(fact)])
  }
}

async function processReady() {
  let processed = 0
  while (true) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await client.query(`SELECT txid,end_id,expected,source_ts_ms
        FROM cdc_ends WHERE processed_at IS NULL ORDER BY topic_offset LIMIT 1 FOR UPDATE`)
      const end = result.rows[0]
      if (!end) { await client.query('COMMIT'); break }
      const counts = await client.query(`SELECT table_name,count(*)::integer AS count
        FROM cdc_rows WHERE txid=$1 GROUP BY table_name`, [end.txid])
      const actual = Object.fromEntries(counts.rows.map(row => [row.table_name, row.count]))
      for (const table of tables) {
        if ((actual[table] ?? 0) > end.expected[table]) throw Error('CDC transaction contains excess rows')
      }
      if (tables.some(table => (actual[table] ?? 0) !== end.expected[table])) {
        await client.query('COMMIT')
        break // ordered prefix has a hole; no later END may be applied
      }
      const rows = await client.query(`SELECT table_name,payload FROM cdc_rows
        WHERE txid=$1 ORDER BY total_order,lsn,event_key`, [end.txid])
      for (const row of rows.rows) await applyRow(client, row.table_name, row.payload)
      await updateFacts(client, end)
      await client.query('UPDATE cdc_ends SET processed_at=now() WHERE txid=$1', [end.txid])
      await client.query('COMMIT')
      processed++
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {})
      throw error
    } finally {
      client.release()
    }
  }
  if (processed) console.info(JSON.stringify({ service: 'reference-mapper', processed_transactions: processed }))
}

async function publishPending() {
  while (true) {
    const item = await pool.query(`SELECT seq,change_id,order_id,payload
      FROM fact_outbox WHERE published_at IS NULL ORDER BY seq LIMIT 1`)
    if (!item.rows.length) return
    const row = item.rows[0]
    await producer.send({ topic: config.factTopic, messages: [{
      key: `${config.sourceInstanceId}:${row.order_id}`,
      value: JSON.stringify(row.payload),
    }] })
    await pool.query('UPDATE fact_outbox SET published_at=now() WHERE seq=$1 AND published_at IS NULL', [row.seq])
  }
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
  await Promise.allSettled([consumer.disconnect(), producer.disconnect()])
  await pool.end()
  resolveShutdown()
}
process.once('SIGTERM', () => { void stop() })
process.once('SIGINT', () => { void stop() })

try {
  await pool.query(schema)
  await producer.connect()
  await consumer.connect()
  for (const topic of [...rowTopics.keys(), endTopic]) {
    await consumer.subscribe({ topic, fromBeginning: true })
  }
  await processReady()
  await publishPending()
  console.info(JSON.stringify({ service: 'reference-mapper', status: 'READY', fact_topic: config.factTopic }))
  await consumer.run({ autoCommit: false, partitionsConsumedConcurrently: 1,
    eachMessage: async context => {
      const failAfterCommit = await persistInput(context)
      if (failAfterCommit) {
        console.error(JSON.stringify({ service: 'reference-mapper', code: 'SHADOW_FAULT_AFTER_DURABLE_INBOX' }))
        process.exit(77) // only opt-in shadow fault injection
      }
      await consumer.commitOffsets([{
        topic: context.topic, partition: context.partition,
        offset: (BigInt(context.message.offset) + 1n).toString(),
      }])
      await processReady()
      await publishPending()
    },
  })
  await Promise.race([shutdown, consumerCrash])
} catch (error) {
  console.error(JSON.stringify({ service: 'reference-mapper', code: 'FATAL', message: String(error.message).slice(0, 180) }))
  process.exitCode = 1
  await stop()
}
