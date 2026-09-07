import test from "node:test"
import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import pg from "pg"
import { inspectClaims } from "../src/claim-inspector.js"
import { createPostgresReceiptCoordinator } from "../src/postgres-receipt-coordinator.js"

test("PostgreSQL inspection is source-scoped and leaves coordination ledger unchanged",
  { skip: !process.env.TEST_DATABASE_URL }, async () => {
    const schema = `claim_inspection_${randomUUID().replaceAll("-", "")}`
    const admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL })
    const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` })
    try {
      await admin.query(`CREATE SCHEMA ${schema}`)
      for (const name of ["005_ingress_telemetry.sql", "013_ingress_coordination.sql", "014_ingress_send_guard.sql", "015_ingress_send_attempts.sql", "016_ingress_producer_generations.sql", "017_ingress_claim_recovery.sql"]) {
        await pool.query(await readFile(new URL(`../../../infra/postgres/v2/${name}`, import.meta.url), "utf8"))
      }
      const coordinator = createPostgresReceiptCoordinator({ pool, instanceId: "test" })
      coordinator.bindProducerIdentity({ transactionalId: 'test', generationId: 'test-boot' })
      await coordinator.prepareProducerGeneration({ transactionalId: 'test', generationId: 'test-boot' })
      await coordinator.readyProducerGeneration()
      for (const [sourceId, eventId] of [["shop", "pending"], ["shop", "released"], ["shop", "accepted"],
        ["shop", "legacy"], ["other-shop", "hidden"]]) {
        const receipt = { status: "accepted", source_id: sourceId, event_id: eventId,
          ingestion_id: `${sourceId}-${eventId}`, received_at: new Date().toISOString() }
        const claim = await coordinator.claim({ event: { source_id: sourceId, event_id: eventId }, receipt })
        if (eventId === "pending") await coordinator.authorizeSend({ ...receipt, owner_token: claim.owner_token })
        if (eventId === "released") await coordinator.release({ ...receipt, owner_token: claim.owner_token })
        if (["accepted", "legacy"].includes(eventId)) await coordinator.confirmReceipt(receipt)
      }
      await pool.query("UPDATE ingress_receipt_claims SET lease_expires_at = NOW() - INTERVAL '1 minute'")
      await pool.query("UPDATE ingress_receipt_claims SET event_fingerprint = NULL WHERE event_id = 'legacy'")
      const snapshot = () => pool.query("SELECT * FROM ingress_receipt_claims ORDER BY source_id, event_id")
      const before = await snapshot()
      const report = await inspectClaims({ pool, sourceId: "shop" })
      assert.equal(report.claims.length, 4)
      assert.equal(report.kafka_outcome_verified, false)
      const dispositions = Object.fromEntries(report.claims.map(row => [row.event_id, row.disposition]))
      assert.equal(report.claims.find(row => row.event_id === 'pending').producer_attempt.transactional_id, 'test')
      assert.equal(report.claims.find(row => row.event_id === 'pending').producer_attempt.generation_id, 'test-boot')
      assert.equal(report.claims.find(row => row.event_id === 'legacy').producer_attempt, null)
      assert.deepEqual(dispositions, { pending: "PENDING_TRANSACTION_EVIDENCE", released: "RETRY_ELIGIBLE",
        accepted: "ACCEPTED_IN_LEDGER", legacy: "MISSING_FINGERPRINT_EVIDENCE" })
      for (const row of report.claims) {
        assert.equal(row.lease_expired, true)
        assert.equal(Object.hasOwn(row, "owner_token"), false)
        assert.equal(Object.hasOwn(row, "receipt_document"), false)
      }
      assert.equal((await inspectClaims({ pool, sourceId: "shop", limit: 1 })).truncated, true)
      assert.equal((await inspectClaims({ pool, sourceId: "shop", eventId: "pending" })).claims.length, 1)
      assert.equal((await inspectClaims({ pool, sourceId: "shop' OR true --" })).claims.length, 0)
      assert.deepEqual((await snapshot()).rows, before.rows)
    } finally {
      await pool.end()
      await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`)
      await admin.end()
    }
  })
