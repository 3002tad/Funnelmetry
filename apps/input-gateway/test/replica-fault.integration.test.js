import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'
import { Kafka, logLevel } from 'kafkajs'

const enabled = process.env.TEST_KAFKA_BROKERS && process.env.TEST_DATABASE_URL

async function until(check, label) {
  const deadline = Date.now() + 45_000
  while (Date.now() < deadline) {
    const value = await check()
    if (value) return value
    await delay(100)
  }
  throw new Error(`timeout: ${label}`)
}

test('two HTTP Gateway processes: concurrent event, SIGKILL after commit, restart without raw duplicate',
  { skip: !enabled, timeout: 180_000 }, async () => {
    const id = randomUUID().replaceAll('-', '')
    const schema = `gateway_fault_${id}`
    const rawTopic = `gateway-fault-${id}-raw`
    const receiptTopic = `gateway-fault-${id}-receipts`
    const brokers = process.env.TEST_KAFKA_BROKERS.split(',')
    const kafka = new Kafka({ brokers, clientId: `fault-${id}`, logLevel: logLevel.ERROR })
    const admin = kafka.admin()
    const db = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` })
    const children = []
    const observer = kafka.consumer({ groupId: `observer-${id}`, readUncommitted: false })
    const raw = []
    async function start(instanceId, killAfterCommit = false) {
      const child = fork(new URL('./fixtures/gateway-process.js', import.meta.url), [], {
        env: { ...process.env, GATEWAY_TEST_CONFIG: JSON.stringify({ schema, brokers, rawTopic,
          receiptTopic, instanceId, clientId: `gateway-${id}`, killAfterCommit }) },
        stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
      })
      children.push(child)
      const [message] = await once(child, 'message', { signal: AbortSignal.timeout(60_000) })
      return { child, url: `http://127.0.0.1:${message.port}` }
    }
    async function send(gateway, event) {
      const response = await fetch(`${gateway.url}/v1/ingress/events`, {
        method: 'POST', headers: { 'content-type': 'application/json',
          'x-funnelmetry-source-key-id': 'test', 'x-funnelmetry-write-key': 'test-secret' },
        body: JSON.stringify(event), signal: AbortSignal.timeout(10_000),
      })
      return response.json()
    }
    try {
      await db.query(`CREATE SCHEMA ${schema}`)
      for (const name of ['005_ingress_telemetry.sql', '013_ingress_coordination.sql']) {
        await pool.query(await readFile(new URL(`../../../infra/postgres/v2/${name}`, import.meta.url), 'utf8'))
      }
      await admin.connect()
      await admin.createTopics({ topics: [rawTopic, receiptTopic].map(topic => ({ topic,
        numPartitions: 1, replicationFactor: 1 })) })
      await observer.connect()
      await observer.subscribe({ topic: rawTopic, fromBeginning: true })
      await observer.run({ eachMessage: async ({ message }) => raw.push(JSON.parse(message.value.toString())) })
      const a = await start('a')
      const b = await start('b')
      const event = { specversion: 'ingress-event.v1', source_id: 'test-source', event_id: 'concurrent',
        source_event_type: 'behavior.product_viewed', source_schema_version: '1.0',
        occurred_at: new Date().toISOString(), producer: 'browser_sdk', source_payload: { product_id: 'p1' } }
      const answers = await Promise.all([send(a, event), send(b, event)])
      assert.equal(answers.filter(r => r.status === 'accepted').length, 1)
      const receipt = answers.find(r => r.status === 'accepted')
      assert.equal((await send(b, event)).ingestion_id, receipt.ingestion_id)
      const conflict = await send(a, { ...event, source_payload: { product_id: 'other' } })
      assert.equal(conflict.reason_code, 'event_identity_conflict')

      const doomed = await start('doomed', true)
      const death = once(doomed.child, 'exit')
      const crashEvent = { ...event, event_id: 'crash-after-commit' }
      await assert.rejects(send(doomed, crashEvent))
      const [, signal] = await death
      assert.equal(signal, 'SIGKILL')
      await until(async () => {
        const rows = await pool.query("SELECT claim_state FROM ingress_receipt_claims WHERE event_id = $1", [crashEvent.event_id])
        return rows.rows[0]?.claim_state === 'ACCEPTED'
      }, 'surviving receipt consumer recovers claim without HTTP retry')
      const recovered = await send(b, crashEvent)
      assert.equal(recovered.status, 'duplicate')
      const restarted = await start('doomed')
      assert.equal((await send(restarted, crashEvent)).ingestion_id, recovered.ingestion_id)
      await until(() => raw.length >= 2, 'raw records observed')
      await delay(1000)
      assert.equal(raw.length, 2)
      assert.equal(raw.filter(r => r.ingestion_id === recovered.ingestion_id).length, 1)
      console.log('[gateway-fault] PASS two-process concurrency, SIGKILL recovery, restart; raw=2 unique=2')
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
      await admin.deleteTopics({ topics: [rawTopic, receiptTopic] })
      await admin.disconnect()
      await pool.end()
      await db.query(`DROP SCHEMA ${schema} CASCADE`)
      await db.end()
    }
  })
