import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'
import { Kafka, logLevel } from 'kafkajs'

async function until(check, label) {
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const result = await check()
    if (result) return result
    await delay(100)
  }
  throw new Error(`timeout: ${label}`)
}

test('SIGKILL after PostgreSQL commit replays input without changing KPI facts', {
  skip: !process.env.TEST_DATABASE_URL || !process.env.TEST_KAFKA_BROKERS || process.platform === 'win32',
  timeout: 180_000,
}, async () => {
  const id = randomUUID().replaceAll('-', '')
  const schema = `kpi_fault_${id}`
  const config = { schema, brokers: process.env.TEST_KAFKA_BROKERS.split(','), clientId: `kpi-${id}`,
    consumerGroupId: `kpi-group-${id}`, instanceId: 'slot',
    funnelUpdatedTopic: `kpi-fault-${id}-input`, kpiUpdatedTopic: `kpi-fault-${id}-output` }
  const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` })
  const kafka = new Kafka({ brokers: config.brokers, clientId: `test-${id}`, logLevel: logLevel.ERROR })
  const admin = kafka.admin()
  const producer = kafka.producer()
  const observer = kafka.consumer({ groupId: `observe-${id}`, readUncommitted: false })
  const outputs = []
  const children = []
  async function start(crash) {
    const child = fork(new URL('./fixtures/crash-process.js', import.meta.url), [], {
      env: { ...process.env, KPI_FAULT_CONFIG: JSON.stringify({ ...config, crash }) },
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    })
    children.push(child)
    await once(child, 'message', { signal: AbortSignal.timeout(60_000) })
    return child
  }
  async function snapshot() {
    const result = {}
    for (const table of ['funnel_kpi_instance_facts', 'funnel_kpi_step_facts', 'kpi_projection_applications']) {
      result[table] = (await pool.query(`SELECT * FROM ${table}`)).rows
    }
    return result
  }
  try {
    await db.query(`CREATE SCHEMA ${schema}`)
    for (const migration of ['001_canonical_ledger.sql', '002_journey_projection.sql', '003_funnel_projection.sql',
      '004_kpi_projection.sql', '006_funnel_maturity.sql', '007_maturity_finalization.sql', '018_kpi_handoff_evidence.sql']) {
      await pool.query(await readFile(new URL(`../../../infra/postgres/v2/${migration}`, import.meta.url), 'utf8'))
    }
    await pool.query(`
      INSERT INTO canonical_events (canonical_event_id,source_id,source_event_id,event_type,event_class,
        canonical_schema_version,mapping_version,occurred_at,ingested_at,normalized_at,data,quality,
        raw_record_id,raw_content_hash,raw_byte_size,canonical_document)
      VALUES ('event','shop','source-event','behavior.product_viewed','BEHAVIOR_INTENT',
        'canonical-event.v1','test',NOW(),NOW(),NOW(),'{}','{}','raw',repeat('a',64),0,'{}');
      INSERT INTO journeys (journey_id,source_id,first_event_at,last_event_at) VALUES ('journey','shop',NOW(),NOW());
      INSERT INTO funnel_profiles (funnel_profile_id,profile_version,display_name,subject_scope,entry_event_type,
        profile_document,published_at) VALUES ('profile','1','Test','JOURNEY','behavior.product_viewed','{}',NOW());
      INSERT INTO funnel_profile_steps (funnel_profile_id,profile_version,step_index,step_id,event_type,event_class)
        VALUES ('profile','1',0,'view','behavior.product_viewed','BEHAVIOR_INTENT');
      INSERT INTO funnel_instances (funnel_instance_id,source_id,journey_id,funnel_profile_id,profile_version,
        entry_event_id,entry_at,outcome_status,quality_status)
        VALUES ('instance','shop','journey','profile','1','event',NOW(),'IN_PROGRESS','PROVISIONAL');
      INSERT INTO funnel_instance_steps (funnel_instance_id,step_index,step_id,event_type,representative_event_id,
        first_reached_at,last_reached_at,occurrence_count,sequence_status)
        VALUES ('instance',0,'view','behavior.product_viewed','event',NOW(),NOW(),1,'IN_ORDER');
    `)
    await admin.connect()
    await admin.createTopics({ waitForLeaders: true, topics: [config.funnelUpdatedTopic, config.kpiUpdatedTopic]
      .map(topic => ({ topic, numPartitions: 1, replicationFactor: 1 })) })
    await producer.connect()
    await observer.connect()
    await observer.subscribe({ topic: config.kpiUpdatedTopic, fromBeginning: true })
    await observer.run({ eachMessage: async ({ message }) => outputs.push(JSON.parse(message.value.toString())) })
    const crashing = await start(true)
    const death = once(crashing, 'exit', { signal: AbortSignal.timeout(60_000) })
    await producer.send({ topic: config.funnelUpdatedTopic, messages: [{ key: JSON.stringify(['shop', 'journey']),
      value: JSON.stringify({ status: 'funnel_updated', canonical_event_id: 'event', journey_id: 'journey',
        updates: [{ funnel_instance_id: 'instance' }] }) }] })
    assert.equal((await death)[1], 'SIGKILL')
    const before = await snapshot()
    assert.equal(before.kpi_projection_applications.length, 1)
    assert.equal(before.funnel_kpi_instance_facts[0].projection_revision, '1')
    assert.equal(before.funnel_kpi_step_facts[0].occurrence_count, '1')
    const pending = await admin.fetchOffsets({ groupId: config.consumerGroupId, topics: [config.funnelUpdatedTopic] })
    assert.equal(pending[0].partitions[0].offset, '-1', 'crashed worker must not commit input offset')
    assert.equal((await admin.fetchTopicOffsets(config.kpiUpdatedTopic))[0].offset, '0')
    await start(false)
    await until(() => outputs.length === 1, 'committed handoff after replay')
    assert.equal(outputs[0].projection_status, 'duplicate')
    assert.equal(outputs[0].trigger_event_id, 'event')
    assert.equal(outputs[0].changed_instances.length, 1)
    assert.deepEqual(outputs[0].changed_instances, before.kpi_projection_applications[0].changed_instances)
    assert.equal(outputs[0].applied_at, before.kpi_projection_applications[0].applied_at.toISOString())
    await until(async () => {
      const offsets = await admin.fetchOffsets({ groupId: config.consumerGroupId, topics: [config.funnelUpdatedTopic] })
      return offsets[0].partitions[0].offset === '1'
    }, 'atomic handoff and input offset commit')
    assert.deepEqual(await snapshot(), before, 'redelivery changed persisted KPI facts')
    console.log('[kpi-fault] PASS post-PG SIGKILL; replay=duplicate, revision=1, occurrence=1, input-offset=1')
  } finally {
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue
      const done = once(child, 'exit')
      child.send('stop')
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000)
      await done
      clearTimeout(timer)
    }
    await observer.disconnect()
    await producer.disconnect()
    await admin.deleteTopics({ topics: [config.funnelUpdatedTopic, config.kpiUpdatedTopic] }).catch(() => {})
    await admin.disconnect()
    await pool.end()
    await db.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
    await db.end()
  }
})
