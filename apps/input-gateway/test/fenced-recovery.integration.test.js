import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import pg from 'pg'
import { createPostgresReceiptCoordinator } from '../src/postgres-receipt-coordinator.js'

test('recovery releases only matching fenced attempts and records atomic audit',
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const schema = `recovery_${randomUUID().replaceAll('-', '')}`
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` })
    const scope = { clusterId: 'cluster', rawTopic: 'raw', receiptTopic: 'receipts' }
    async function boot(generationId, kafkaScope = scope, transactionalId = 'slot', ready = true) {
      const coordinator = createPostgresReceiptCoordinator({ pool, instanceId: transactionalId })
      await coordinator.prepareProducerGeneration({ transactionalId, generationId })
      coordinator.bindProducerIdentity({ transactionalId, generationId, kafkaScope })
      if (ready) await coordinator.readyProducerGeneration()
      return coordinator
    }
    async function send(coordinator, eventId, accepted = false) {
      const event = { source_id: 'shop', event_id: eventId }
      const receipt = { ...event, status: 'accepted', ingestion_id: `ing_${eventId}`, received_at: new Date().toISOString() }
      const claim = await coordinator.claim({ event, receipt })
      await coordinator.authorizeSend({ ...event, owner_token: claim.owner_token })
      if (accepted) await coordinator.confirmReceipt(receipt)
      return { event, receipt, claim }
    }
    try {
      await admin.query(`CREATE SCHEMA ${schema}`)
      for (const name of ['005_ingress_telemetry.sql', '013_ingress_coordination.sql', '014_ingress_send_guard.sql',
        '015_ingress_send_attempts.sql', '016_ingress_producer_generations.sql', '017_ingress_claim_recovery.sql']) {
        const sql = await readFile(new URL(`../../../infra/postgres/v2/${name}`, import.meta.url), 'utf8')
        await pool.query(sql)
        await pool.query(sql)
      }
      const old = await boot('old')
      const pending = await send(old, 'pending')
      await send(old, 'accepted', true)
      await send(await boot('legacy', null), 'missing-scope')
      await send(await boot('different-cluster', { ...scope, clusterId: 'other' }), 'wrong-scope')
      await send(await boot('other', scope, 'other-slot'), 'other-slot')
      const replacement = await boot('replacement', scope, 'slot', false)
      const barrier = { replayOffsets: [{ partition: 0, offset: '9007199254740994' }] }
      await assert.rejects(replacement.recoverFencedClaims({ replayOffsets: [] }), /offsets/)
      assert.deepEqual(await replacement.recoverFencedClaims(barrier), { recovered: 1 })
      assert.deepEqual(await replacement.recoverFencedClaims(barrier), { recovered: 0 })
      const rows = (await pool.query('SELECT event_id,claim_state,owner_token FROM ingress_receipt_claims')).rows
      assert.equal(rows.find(row => row.event_id === 'pending').owner_token, 'released')
      assert.equal(rows.find(row => row.event_id === 'accepted').claim_state, 'ACCEPTED')
      for (const name of ['missing-scope', 'wrong-scope', 'other-slot']) {
        assert.notEqual(rows.find(row => row.event_id === name).owner_token, 'released')
      }
      const audit = (await pool.query('SELECT * FROM ingress_claim_recoveries')).rows
      assert.equal(audit.length, 1)
      assert.equal(audit[0].owner_token, pending.claim.owner_token)
      assert.equal(audit[0].previous_generation_id, 'old')
      assert.equal(audit[0].recovery_generation_id, 'replacement')
      assert.deepEqual(audit[0].replay_offsets, barrier.replayOffsets)
      await replacement.readyProducerGeneration()
      await assert.rejects(replacement.recoverFencedClaims(barrier), /no longer initializing/)
      const retry = await replacement.claim(pending)
      assert.equal(retry.status, 'claimed')
      assert.equal(retry.receipt.ingestion_id, pending.receipt.ingestion_id)
      await replacement.authorizeSend({ ...pending.event, owner_token: retry.owner_token })

      // An audit insertion error must roll back the release in the same transaction.
      const next = await boot('next', scope, 'slot', false)
      await pool.query(`INSERT INTO ingress_claim_recoveries
        (source_id,event_id,owner_token,ingestion_id,transactional_id,previous_generation_id,
         recovery_generation_id,kafka_scope,replay_offsets)
        VALUES ('shop','pending',$1,$2,'slot','replacement','test-conflict',$3::jsonb,$4::jsonb)`,
      [retry.owner_token, retry.receipt.ingestion_id, JSON.stringify(scope), JSON.stringify(barrier.replayOffsets)])
      await assert.rejects(next.recoverFencedClaims(barrier), error => error.code === '23505')
      assert.equal((await pool.query("SELECT owner_token FROM ingress_receipt_claims WHERE event_id = 'pending'")).rows[0].owner_token,
        retry.owner_token)
      await boot('superseding', scope, 'slot', false)
      await assert.rejects(next.recoverFencedClaims(barrier), /no longer initializing/)
    } finally {
      await pool.end()
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
      await admin.end()
    }
  })
