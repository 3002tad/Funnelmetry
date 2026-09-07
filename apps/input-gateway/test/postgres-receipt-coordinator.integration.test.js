import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"
import pg from "pg"
import {
  createPostgresReceiptCoordinator,
  fingerprintIngressEvent,
} from "../src/postgres-receipt-coordinator.js"

const databaseUrl = process.env.TEST_DATABASE_URL
const event = {
  specversion: "ingress-event.v1",
  source_id: "medusa-reference",
  event_id: "medusa:order-1:placed:v1",
  source_event_type: "order.placed",
  source_schema_version: "1.0",
  occurred_at: "2026-09-05T03:00:00.000Z",
  producer: "source_bridge",
  source_payload: { amount: 125000, order_id: "order_1" },
}
const receipt = {
  status: "accepted",
  source_id: event.source_id,
  event_id: event.event_id,
  ingestion_id: "ing_shared",
  ingestion_attempt_id: "attempt-1",
  received_at: "2026-09-05T03:00:01.000Z",
}

test("fingerprint is stable across object key ordering", () => {
  assert.equal(
    fingerprintIngressEvent(event),
    fingerprintIngressEvent({ ...event, source_payload: { order_id: "order_1", amount: 125000 } }),
  )
})

test("coordinates claim, takeover, completion and conflict across replicas", { skip: !databaseUrl }, async () => {
  const schema = `ingress_coordination_${randomUUID().replaceAll("-", "")}`
  const admin = new pg.Pool({ connectionString: databaseUrl })
  await admin.query(`CREATE SCHEMA ${schema}`)
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
  try {
    for (const migrationName of ["005_ingress_telemetry.sql", "013_ingress_coordination.sql", "014_ingress_send_guard.sql", "015_ingress_send_attempts.sql", "016_ingress_producer_generations.sql", "017_ingress_claim_recovery.sql"]) {
      const migration = await readFile(
        new URL(`../../../infra/postgres/v2/${migrationName}`, import.meta.url), "utf8",
      )
      await pool.query(migration)
      await pool.query(migration)
    }
    const clock = { value: new Date() }
    const first = createPostgresReceiptCoordinator({
      pool, instanceId: "gateway-1", leaseMs: 30_000, now: () => clock.value,
      createOwnerToken: () => "claim-1",
    })
    const second = createPostgresReceiptCoordinator({
      pool, instanceId: "gateway-2", leaseMs: 30_000, now: () => clock.value,
      createOwnerToken: () => "claim-2",
    })

    const claimed = await first.claim({ event, receipt })
    await assert.rejects(first.authorizeSend({ ...event, owner_token: claimed.owner_token }), /must be bound/)
    first.bindProducerIdentity({ transactionalId: 'test-gateway-1', generationId: 'boot-1' })
    second.bindProducerIdentity({ transactionalId: 'test-gateway-2', generationId: 'boot-2' })
    await first.prepareProducerGeneration({ transactionalId: 'test-gateway-1', generationId: 'boot-1' })
    await second.prepareProducerGeneration({ transactionalId: 'test-gateway-2', generationId: 'boot-2' })
    await first.readyProducerGeneration()
    await second.readyProducerGeneration()
    assert.throws(() => first.bindProducerIdentity({ transactionalId: 'other', generationId: 'other' }), /cannot change/)
    assert.equal(claimed.status, "claimed")
    assert.equal(claimed.receipt.ingestion_id, "ing_shared")
    await first.authorizeSend({ ...event, owner_token: claimed.owner_token })
    const attempt = (await pool.query('SELECT * FROM ingress_send_attempts')).rows[0]
    assert.equal(attempt.transactional_id, 'test-gateway-1')
    assert.equal(attempt.producer_generation_id, 'boot-1')
    assert.equal(attempt.ingestion_id, claimed.receipt.ingestion_id)
    await assert.rejects(first.confirmReceipt({ ...receipt, ingestion_id: 'wrong-ingestion' }), /conflicts/)
    assert.equal((await pool.query('SELECT claim_state FROM ingress_receipt_claims')).rows[0].claim_state, 'CLAIMED')
    assert.equal((await second.claim({ event, receipt: { ...receipt, ingestion_id: "ing_other" } })).status, "pending")

    clock.value = new Date(clock.value.getTime() + 60_000)
    await pool.query("UPDATE ingress_receipt_claims SET lease_expires_at = NOW() - INTERVAL '1 minute'")
    assert.equal((await second.claim({ event, receipt })).status, "pending",
      "expired lease is not evidence that Kafka failed to commit")

    await first.release({ source_id: event.source_id, event_id: event.event_id, owner_token: claimed.owner_token })
    clock.value = new Date(clock.value.getTime() + 1_000)
    const takeover = await second.claim({ event, receipt: { ...receipt, ingestion_id: "ing_other" } })
    assert.equal(takeover.status, "claimed")
    assert.equal(takeover.receipt.ingestion_id, "ing_shared")
    await second.authorizeSend({ ...event, owner_token: takeover.owner_token })
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ingress_send_attempts')).rows[0].count, 2)
    await first.confirmReceipt(takeover.receipt)
    await first.confirmReceipt(takeover.receipt)
    await second.complete({
      source_id: event.source_id, event_id: event.event_id, owner_token: takeover.owner_token,
    })

    const duplicate = await first.claim({ event, receipt })
    assert.equal(duplicate.status, "duplicate")
    assert.equal(duplicate.receipt.ingestion_id, "ing_shared")
    const conflict = await first.claim({
      event: { ...event, source_payload: { order_id: "order_changed" } }, receipt,
    })
    assert.equal(conflict.status, "conflict")
    const anotherEvent = { ...event, event_id: 'concurrent-event' }
    const anotherReceipt = { ...receipt, event_id: anotherEvent.event_id, ingestion_id: 'ing_concurrent' }
    const claims = await Promise.all([
      first.claim({ event: anotherEvent, receipt: anotherReceipt }),
      second.claim({ event: anotherEvent, receipt: { ...anotherReceipt, ingestion_id: 'ing_loser' } }),
    ])
    assert.deepEqual(claims.map(c => c.status).sort(), ['claimed', 'pending'])
    const recovered = await second.adopt({ event: anotherEvent, receipt: claims.find(c => c.status === 'claimed').receipt })
    assert.equal(recovered.status, 'duplicate')
    assert.equal((await first.claim({ event: anotherEvent, receipt: anotherReceipt })).status, 'duplicate')
    await pool.query("UPDATE ingress_receipt_claims SET event_fingerprint = NULL WHERE event_id = $1", [anotherEvent.event_id])
    assert.equal((await first.claim({ event: anotherEvent, receipt: anotherReceipt })).status, 'pending')
    assert.equal((await first.adopt({ event: anotherEvent, receipt: anotherReceipt })).status, 'pending')
    assert.equal((await pool.query('SELECT event_fingerprint FROM ingress_receipt_claims WHERE event_id = $1',
      [anotherEvent.event_id])).rows[0].event_fingerprint, null, 'retry cannot invent the historical fingerprint')
    assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM ingress_receipt_claims")).rows[0].count, 2)

    const beforeSendEvent = { ...event, event_id: 'before-send' }
    const beforeSendReceipt = { ...receipt, event_id: beforeSendEvent.event_id, ingestion_id: 'ing_before_send' }
    const old = await first.claim({ event: beforeSendEvent, receipt: beforeSendReceipt })
    await pool.query("UPDATE ingress_receipt_claims SET lease_expires_at = NOW() - INTERVAL '1 minute' WHERE event_id = $1",
      [beforeSendEvent.event_id])
    const replacement = await second.claim({ event: beforeSendEvent, receipt: { ...beforeSendReceipt, ingestion_id: 'discard' } })
    assert.equal(replacement.status, 'claimed')
    assert.equal(replacement.receipt.ingestion_id, old.receipt.ingestion_id)
    await assert.rejects(first.authorizeSend({ ...beforeSendEvent, owner_token: old.owner_token }), /denied/)
    await first.release({ ...beforeSendEvent, owner_token: old.owner_token })
    await second.authorizeSend({ ...beforeSendEvent, owner_token: replacement.owner_token })
    await assert.rejects(second.authorizeSend({ ...beforeSendEvent, owner_token: replacement.owner_token }), /denied/)
    await pool.query("UPDATE ingress_receipt_claims SET lease_expires_at = NOW() - INTERVAL '1 minute' WHERE event_id = $1",
      [beforeSendEvent.event_id])
    assert.equal((await first.claim({ event: beforeSendEvent, receipt: beforeSendReceipt })).status, 'pending')

    // A legacy owner change cannot inherit proof that its own send has not begun.
    await pool.query("UPDATE ingress_receipt_claims SET send_authorized = FALSE, owner_token = 'legacy-owner' WHERE event_id = $1",
      [beforeSendEvent.event_id])
    assert.equal((await first.claim({ event: beforeSendEvent, receipt: beforeSendReceipt })).status, 'pending')

    for (let index = 0; index < 6; index++) {
      const raceEvent = { ...event, event_id: `guard-race-${index}` }
      const raceReceipt = { ...receipt, event_id: raceEvent.event_id, ingestion_id: `ing_race_${index}` }
      const initial = await first.claim({ event: raceEvent, receipt: raceReceipt })
      await pool.query("UPDATE ingress_receipt_claims SET lease_expires_at = NOW() - INTERVAL '1 minute' WHERE event_id = $1",
        [raceEvent.event_id])
      const [authorization, retry] = await Promise.allSettled([
        first.authorizeSend({ ...raceEvent, owner_token: initial.owner_token }),
        second.claim({ event: raceEvent, receipt: raceReceipt }),
      ])
      assert.equal(retry.status, 'fulfilled')
      if (authorization.status === 'fulfilled') assert.equal(retry.value.status, 'pending')
      else {
        assert.equal(retry.value.status, 'claimed')
        await second.authorizeSend({ ...raceEvent, owner_token: retry.value.owner_token })
      }
    }

    const legacyEvent = { ...event, event_id: 'legacy-claim' }
    const legacyReceipt = { ...receipt, event_id: legacyEvent.event_id, ingestion_id: 'ing_legacy' }
    await pool.query(`INSERT INTO ingress_receipt_claims
      (source_id,event_id,event_fingerprint,ingestion_id,receipt_document,claim_state,owner_token,lease_expires_at)
      VALUES ($1,$2,$3,$4,$5::jsonb,'CLAIMED','legacy',NOW() - INTERVAL '1 minute')`,
    [legacyEvent.source_id, legacyEvent.event_id, fingerprintIngressEvent(legacyEvent), legacyReceipt.ingestion_id,
      JSON.stringify(legacyReceipt)])
    assert.equal((await first.claim({ event: legacyEvent, receipt: legacyReceipt })).status, 'pending')

    // If recording the evidence fails, send permission must roll back too.
    const atomicEvent = { ...event, event_id: 'atomic-evidence' }
    const atomicReceipt = { ...receipt, event_id: atomicEvent.event_id, ingestion_id: 'ing_atomic' }
    const atomicClaim = await first.claim({ event: atomicEvent, receipt: atomicReceipt })
    await pool.query(`INSERT INTO ingress_send_attempts
      (source_id,event_id,owner_token,ingestion_id,transactional_id,producer_generation_id)
      VALUES ($1,$2,$3,$4,'test-conflict','test-conflict')`,
    [event.source_id, atomicEvent.event_id, atomicClaim.owner_token, atomicReceipt.ingestion_id])
    await assert.rejects(first.authorizeSend({ ...atomicEvent, owner_token: atomicClaim.owner_token }),
      error => error.code === '23505')
    assert.equal((await pool.query('SELECT send_authorized FROM ingress_receipt_claims WHERE event_id = $1',
      [atomicEvent.event_id])).rows[0].send_authorized, false)

    const revokedEvent = { ...event, event_id: 'generation-revoked' }
    const revokedReceipt = { ...receipt, event_id: revokedEvent.event_id, ingestion_id: 'ing_revoked' }
    const oldClaim = await first.claim({ event: revokedEvent, receipt: revokedReceipt })
    const replacementCoordinator = createPostgresReceiptCoordinator({ pool, instanceId: 'gateway-1' })
    await replacementCoordinator.prepareProducerGeneration({ transactionalId: 'test-gateway-1', generationId: 'boot-new' })
    await assert.rejects(first.authorizeSend({ ...revokedEvent, owner_token: oldClaim.owner_token }),
      error => error.code === 'INGRESS_GENERATION_REVOKED')
    await assert.rejects(first.readyProducerGeneration(), /superseded/)
    replacementCoordinator.bindProducerIdentity({ transactionalId: 'test-gateway-1', generationId: 'boot-new' })
    await pool.query("UPDATE ingress_receipt_claims SET lease_expires_at = NOW() - INTERVAL '1 minute' WHERE event_id = $1",
      [revokedEvent.event_id])
    const newClaim = await replacementCoordinator.claim({ event: revokedEvent, receipt: revokedReceipt })
    await assert.rejects(replacementCoordinator.authorizeSend({ ...revokedEvent, owner_token: newClaim.owner_token }),
      error => error.code === 'INGRESS_GENERATION_REVOKED')
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM ingress_send_attempts WHERE event_id = $1',
      [revokedEvent.event_id])).rows[0].count, 0)
    await replacementCoordinator.readyProducerGeneration()
    await replacementCoordinator.authorizeSend({ ...revokedEvent, owner_token: newClaim.owner_token })
    assert.equal((await pool.query('SELECT producer_generation_id FROM ingress_send_attempts WHERE event_id = $1',
      [revokedEvent.event_id])).rows[0].producer_generation_id, 'boot-new')
    await assert.rejects(replacementCoordinator.prepareProducerGeneration({ transactionalId: 'test-gateway-1', generationId: 'boot-reuse' }),
      /new coordinator/)

    // Another slot remains independent of a replacement on gateway-1.
    const independent = { ...event, event_id: 'independent-slot' }
    const independentClaim = await second.claim({ event: independent,
      receipt: { ...receipt, event_id: independent.event_id, ingestion_id: 'ing_independent' } })
    await second.authorizeSend({ ...independent, owner_token: independentClaim.owner_token })
  } finally {
    await pool.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  }
})
