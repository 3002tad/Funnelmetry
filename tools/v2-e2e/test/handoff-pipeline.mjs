// Synthetic schema-2.0 fixture equivalent to medusa-downstream.test.mjs.
// Executes inside the test worker image. Does NOT contact Medusa or a public feed.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { toRawMessage } from '/workspace/workers/source-connector/src/connector.js'
const require = createRequire('/workspace/workers/source-connector/package.json')
const { Kafka, logLevel } = require('kafkajs')
const { Client } = require('pg')
const mode = process.env.HANDOFF_PIPELINE_TEST
assert.ok(['initial', 'resume', 'watchdog-enqueue', 'watchdog-verify', 'scale-enqueue', 'scale-replay'].includes(mode))
const scaleMode = mode.startsWith('scale-')
const expectedCount = mode === 'watchdog-verify' || scaleMode ? 5 : Number(process.env.HANDOFF_EXPECT_EVENTS || 4)
assert.equal(process.env.POSTGRES_DB, 'funnelmetry_handoff')
assert.equal(process.env.POSTGRES_HOST, 'postgres')
const db = new Client({ host: 'postgres', database: 'funnelmetry_handoff', user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD, connectionTimeoutMillis: 10000 })
let producer
let stage = 'database'
try {
  await db.connect()
  // Refuse to write to a normal handoff dataset; test accounts identify this disposable run.
  assert.equal((await db.query("SELECT count(*)::int AS n FROM dashboard_users WHERE email LIKE '%@handoff-acceptance.invalid'")).rows[0].n, 2)
  if (mode === 'initial' || mode === 'watchdog-enqueue' || scaleMode) {
    stage = 'publish'
    assert.equal((await db.query('SELECT count(*)::int AS n FROM canonical_events')).rows[0].n, mode === 'initial' ? 0 : mode === 'scale-replay' ? 5 : 4)
    const types = ['behavior.product_viewed', 'cart.item_added', 'checkout.started', 'medusa.order_placed']
    const payloads = [
      { product_id: 'prod_test', page_instance_id: 'page:test' },
      { cart_id: 'cart_test', product_id: 'prod_test', variant_id: 'variant_test', quantity: 1 },
      { cart_id: 'cart_test', page_instance_id: 'page:test', step: 'address' },
      { order_id: 'order_test', cart_id: 'cart_test', total_amount: '20', currency_code: 'eur', amount_unit: 'major', amount_semantics: 'medusa.order.total',
        items: [{ product_id: 'prod_test', variant_id: 'variant_test', quantity: 1, unit_price_amount: '10' }] },
    ]
    const messages = types.map((type, i) => {
      const time = `2026-09-22T12:00:0${i}.000Z`
      return toRawMessage({ specversion: 'ingress-event.v1', source_id: 'medusa-reference', event_id: `handoff:test:${i}`,
        source_event_type: type, source_schema_version: '2.0', producer: i === 1 || i === 3 ? 'source_bridge' : 'browser_sdk',
        occurred_at: time, accepted_at: time, event_feed_id: 'handoff-synthetic', ingress_seq: i * 2 + 1,
        correlation_id: i ? 'cart:cart_test' : 'session:session_test',
        ...(i < 3 ? { anonymous_id: 'anonymous:test', session_id: 'session_test' } : {}),
        ...(i === 1 ? { aggregate: { type: 'cart', id: 'cart_test' } } : {}),
        ...(i === 3 ? { aggregate: { type: 'order', id: 'order_test' } } : {}), source_payload: payloads[i],
      }, time)
    })
    if (mode === 'watchdog-enqueue' || scaleMode) {
      const time = '2026-09-22T12:00:04.000Z'
      messages.push(toRawMessage({ specversion: 'ingress-event.v1', source_id: 'medusa-reference',
        event_id: 'handoff:watchdog:fresh', source_event_type: 'behavior.page_viewed', source_schema_version: '2.0',
        producer: 'browser_sdk', occurred_at: time, accepted_at: time, event_feed_id: 'handoff-synthetic',
        ingress_seq: 11, anonymous_id: 'anonymous:test', session_id: 'session_test', correlation_id: 'session:session_test',
        source_payload: { page_instance_id: 'page:watchdog', page_type: 'other', path_template: '/recovery' },
      }, time))
    }
    producer = new Kafka({ brokers: ['kafka:9092'], clientId: 'handoff-synthetic-probe', logLevel: logLevel.NOTHING }).producer()
    await producer.connect()
    await producer.send({ topic: 'funnelmetry.raw.v1', acks: -1,
      messages: scaleMode ? messages.map((message, i) => ({ ...message, partition: i % 2 })) : messages })
  }
  if (mode === 'watchdog-enqueue') {
    // Worker is deliberately stopped internally. Do not wait for downstream yet.
    assert.equal((await db.query('SELECT count(*)::int AS n FROM canonical_events')).rows[0].n, 4)
    console.log('PASS: queued four duplicates and one fresh event behind frozen worker')
  } else {
  stage = 'await canonical/journey/funnel/KPI'
  const deadline = Date.now() + 90000
  let ready = false
  while (Date.now() < deadline) {
    const rows = (await db.query('SELECT outcome_status, reached_step_count, profile_version FROM funnel_kpi_instance_facts')).rows
    const count = (await db.query('SELECT count(*)::int AS n FROM canonical_events')).rows[0].n
    if (count === expectedCount && rows.some(r => r.outcome_status === 'CONVERTED' && r.reached_step_count === 4 && r.profile_version === '2.0.0')) { ready = true; break }
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  assert.ok(ready, 'processing deadline')
  stage = 'verify persisted facts'
  assert.equal((await db.query('SELECT count(*)::int AS n FROM canonical_events')).rows[0].n, expectedCount)
  assert.equal((await db.query('SELECT count(*)::int AS n FROM journeys')).rows[0].n, 1)
  assert.deepEqual((await db.query('SELECT currency_code, total_amount::text FROM analytical_fact_order_v1')).rows,
    [{ currency_code: 'EUR', total_amount: '20' }])
  assert.equal((await db.query("SELECT count(*)::int AS n FROM canonical_events WHERE event_type='order.placed' AND event_class='BUSINESS_FACT'")).rows[0].n, 1)
  if (expectedCount === 5) {
    assert.equal((await db.query("SELECT count(*)::int AS n FROM canonical_events WHERE source_event_id='handoff:watchdog:fresh'")).rows[0].n, 1)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM (SELECT source_id, source_event_id FROM canonical_events GROUP BY source_id,source_event_id HAVING count(*) > 1) d')).rows[0].n, 0)
    const admin = new Kafka({ brokers: ['kafka:9092'], clientId: 'watchdog-offset-check', logLevel: logLevel.NOTHING }).admin()
    await admin.connect()
    try {
      let caughtUp = false
      for (let n = 0; n < 60; n++) {
        const ends = await admin.fetchTopicOffsets('funnelmetry.raw.v1')
        const committed = await admin.fetchOffsets({ groupId: 'funnelmetry-canonical-normalizer-v1', topics: ['funnelmetry.raw.v1'] })
        const parts = committed.find(t => t.topic === 'funnelmetry.raw.v1')?.partitions || []
        if (ends.length && ends.every(end => parts.some(p => p.partition === end.partition && p.offset === end.offset))) { caughtUp = true; break }
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
      assert.ok(caughtUp, 'normalizer committed offset must catch up to broker end')
    } finally { await admin.disconnect() }
    console.log('PASS: fresh event exactly once, no duplicate canonical identity, raw consumer caught up')
  }
  console.log(`PASS: synthetic Raw Kafka -> canonical -> Journey -> Funnel -> KPI -> gross order value EUR 20 (${process.env.HANDOFF_PIPELINE_TEST})`)
  }
} catch {
  console.error(`FAIL: isolated pipeline stage: ${stage}`)
  process.exitCode = 1
} finally { await producer?.disconnect(); await db.end() }
