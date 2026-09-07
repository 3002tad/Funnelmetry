import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fork } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import pg from 'pg'
import { Kafka, logLevel } from 'kafkajs'
import { createServer, connect } from 'node:net'

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

test('HTTP replicas: concurrency, crashes before/after commit, database outage and restart',
  { skip: !enabled, timeout: 420_000 }, async () => {
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
    let blockDatabase = false
    const sockets = new Set()
    const database = new URL(process.env.TEST_DATABASE_URL)
    const databaseTarget = { host: database.hostname, port: Number(database.port || 5432) }
    const proxy = createServer(socket => {
      if (blockDatabase) { socket.destroy(); return }
      const upstream = connect(databaseTarget)
      for (const connection of [socket, upstream]) {
        sockets.add(connection)
        connection.on('close', () => sockets.delete(connection))
        connection.on('error', () => { socket.destroy(); upstream.destroy() })
      }
      socket.pipe(upstream).pipe(socket)
      socket.on('close', () => upstream.destroy())
    })
    async function start(instanceId, killAfterCommit = false, options = {}) {
      const child = fork(new URL('./fixtures/gateway-process.js', import.meta.url), [], {
        env: { ...process.env, GATEWAY_TEST_CONFIG: JSON.stringify({ schema, brokers, rawTopic,
          receiptTopic, instanceId, clientId: `gateway-${id}`, killAfterCommit, ...options }) },
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
      for (const name of ['005_ingress_telemetry.sql', '013_ingress_coordination.sql', '014_ingress_send_guard.sql', '015_ingress_send_attempts.sql', '016_ingress_producer_generations.sql', '017_ingress_claim_recovery.sql']) {
        await pool.query(await readFile(new URL(`../../../infra/postgres/v2/${name}`, import.meta.url), 'utf8'))
      }
      await admin.connect()
      await admin.createTopics({ topics: [rawTopic, receiptTopic].map(topic => ({ topic,
        numPartitions: 1, replicationFactor: 1,
        configEntries: topic === receiptTopic ? [{ name: 'cleanup.policy', value: 'compact' }] : [],
      })) })
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

      const before = await start('before-commit', false, { killBeforeCommit: true, transactionTimeoutMs: 5000 })
      const beforeDeath = once(before.child, 'exit')
      const uncommitted = { ...event, event_id: 'crash-before-commit' }
      await assert.rejects(send(before, uncommitted))
      assert.equal((await beforeDeath)[1], 'SIGKILL')
      await pool.query("UPDATE ingress_receipt_claims SET lease_expires_at = NOW() - INTERVAL '1 minute' WHERE event_id = $1", [uncommitted.event_id])
      assert.equal((await send(b, uncommitted)).status, 'retryable_failure')
      assert.equal((await pool.query('SELECT claim_state FROM ingress_receipt_claims WHERE event_id = $1',
        [uncommitted.event_id])).rows[0].claim_state, 'CLAIMED')

      await new Promise(resolve => proxy.listen(0, '127.0.0.1', resolve))
      database.hostname = '127.0.0.1'
      database.port = String(proxy.address().port)
      const dbGateway = await start('db-outage', false, { databaseUrl: database.href, freshDbConnections: true })
      const dbEvent = { ...event, event_id: 'database-outage' }
      blockDatabase = true
      assert.equal((await send(dbGateway, dbEvent)).status, 'retryable_failure')
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ingress_receipt_claims WHERE event_id = $1',
        [dbEvent.event_id])).rows[0].count, 0)
      blockDatabase = false
      assert.equal((await send(dbGateway, dbEvent)).status, 'accepted')
      await until(() => raw.length >= 3, 'fresh event after database restoration and broker transaction timeout')
      assert.equal(raw.length, 3)
      assert.equal(raw.some(r => JSON.parse(r.raw_body).event_id === uncommitted.event_id), false)
      console.log('[gateway-fault] PASS precommit crash remains pending; DB outage retries after restore; committed raw=3')

      const unsent = await start('before-send', false, { killBeforeSend: true })
      const unsentDeath = once(unsent.child, 'exit')
      const unsentEvent = { ...event, event_id: 'crash-before-send' }
      await assert.rejects(send(unsent, unsentEvent))
      assert.equal((await unsentDeath)[1], 'SIGKILL')
      const originalClaim = (await pool.query('SELECT * FROM ingress_receipt_claims WHERE event_id = $1',
        [unsentEvent.event_id])).rows[0]
      assert.equal(originalClaim.send_authorized, false)
      assert.equal((await send(b, unsentEvent)).status, 'retryable_failure')
      await pool.query("UPDATE ingress_receipt_claims SET lease_expires_at = NOW() - INTERVAL '1 minute' WHERE event_id = $1",
        [unsentEvent.event_id])
      const retried = await send(b, unsentEvent)
      assert.equal(retried.status, 'accepted')
      assert.equal(retried.ingestion_id, originalClaim.ingestion_id)
      assert.equal((await send(a, unsentEvent)).status, 'duplicate')
      await until(() => raw.length >= 4, 'recovered pre-send event')
      assert.equal(raw.length, 4)
      assert.equal(raw.filter(row => row.ingestion_id === originalClaim.ingestion_id).length, 1)
      console.log('[gateway-fault] PASS pre-send SIGKILL recovered on retry with stable ID; committed raw=4')

      // Neither process has sent an event yet: startup must initialize the
      // transactional epoch, or the old process could fence the replacement.
      const oldSlot = await start('fence-slot')
      const newSlot = await start('fence-slot')
      const fencedEvent = { ...event, event_id: 'fenced-owner-first-send' }
      assert.equal((await send(oldSlot, fencedEvent)).status, 'retryable_failure')
      assert.equal((await fetch(`${oldSlot.url}/health`)).status, 503)
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ingress_send_attempts WHERE event_id = $1',
        [fencedEvent.event_id])).rows[0].count, 0, 'revoked generation cannot get send permission')
      assert.equal((await send(newSlot, fencedEvent)).status, 'retryable_failure')
      await pool.query("UPDATE ingress_receipt_claims SET lease_expires_at = NOW() - INTERVAL '1 minute' WHERE event_id = $1",
        [fencedEvent.event_id])
      assert.equal((await send(newSlot, fencedEvent)).status, 'accepted')
      assert.equal((await send(newSlot, fencedEvent)).status, 'duplicate')
      await until(() => raw.length >= 5, 'replacement producer writes after fencing old instance')
      assert.equal(raw.length, 5)
      assert.equal(raw.filter(row => JSON.parse(row.raw_body).event_id === fencedEvent.event_id).length, 1)
      const attempts = (await pool.query(
        'SELECT transactional_id, producer_generation_id, ingestion_id FROM ingress_send_attempts WHERE event_id = $1',
        [fencedEvent.event_id])).rows
      assert.equal(attempts.length, 1)
      assert.equal(new Set(attempts.map(row => row.transactional_id)).size, 1)
      assert.equal(attempts[0].transactional_id, `gateway-${id}-fence-slot`)
      const registry = (await pool.query('SELECT * FROM ingress_producer_generations WHERE transactional_id = $1',
        [attempts[0].transactional_id])).rows[0]
      assert.equal(attempts[0].producer_generation_id, registry.generation_id)
      assert.equal(registry.phase, 'READY')
      assert.equal(new Set(attempts.map(row => row.ingestion_id)).size, 1)
      console.log('[gateway-fault] PASS revoked generation blocked before Kafka; replacement accepted after lease; committed raw=5')

      const recoverable = await start('recovery-slot', false, { killBeforeCommit: true, recoverFencedClaims: true })
      const recoverableDeath = once(recoverable.child, 'exit')
      const recoveryEvent = { ...event, event_id: 'fenced-recovery-before-commit' }
      await assert.rejects(send(recoverable, recoveryEvent))
      assert.equal((await recoverableDeath)[1], 'SIGKILL')
      const recoveryClaim = (await pool.query('SELECT * FROM ingress_receipt_claims WHERE event_id = $1',
        [recoveryEvent.event_id])).rows[0]
      assert.equal(recoveryClaim.send_authorized, true)
      const recoveredSlot = await start('recovery-slot', false, { recoverFencedClaims: true })
      assert.equal((await pool.query('SELECT owner_token FROM ingress_receipt_claims WHERE event_id = $1',
        [recoveryEvent.event_id])).rows[0].owner_token, 'released')
      assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ingress_claim_recoveries WHERE event_id = $1',
        [recoveryEvent.event_id])).rows[0].count, 1)
      const recoveryReceipt = await send(recoveredSlot, recoveryEvent)
      assert.equal(recoveryReceipt.status, 'accepted')
      assert.equal(recoveryReceipt.ingestion_id, recoveryClaim.ingestion_id)
      assert.equal((await send(recoveredSlot, recoveryEvent)).status, 'duplicate')
      await until(() => raw.length >= 6, 'recovered transaction committed exactly once')
      assert.equal(raw.length, 6)
      assert.equal(raw.filter(row => row.ingestion_id === recoveryClaim.ingestion_id).length, 1)
      console.log('[gateway-fault] PASS opt-in post-fence recovery after precommit SIGKILL; audited, stable ID; raw=6')
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
      for (const socket of sockets) socket.destroy()
      if (proxy.listening) await new Promise(resolve => proxy.close(resolve))
      await admin.deleteTopics({ topics: [rawTopic, receiptTopic] })
      await admin.disconnect()
      await pool.end()
      await db.query(`DROP SCHEMA ${schema} CASCADE`)
      await db.end()
    }
  })
