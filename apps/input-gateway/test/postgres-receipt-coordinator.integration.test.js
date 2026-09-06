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
    for (const migrationName of ["005_ingress_telemetry.sql", "013_ingress_coordination.sql"]) {
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
    assert.equal(claimed.status, "claimed")
    assert.equal(claimed.receipt.ingestion_id, "ing_shared")
    assert.equal((await second.claim({ event, receipt: { ...receipt, ingestion_id: "ing_other" } })).status, "pending")

    clock.value = new Date(clock.value.getTime() + 60_000)
    assert.equal((await second.claim({ event, receipt })).status, "pending",
      "expired lease is not evidence that Kafka failed to commit")

    await first.release({ source_id: event.source_id, event_id: event.event_id, owner_token: claimed.owner_token })
    clock.value = new Date(clock.value.getTime() + 1_000)
    const takeover = await second.claim({ event, receipt: { ...receipt, ingestion_id: "ing_other" } })
    assert.equal(takeover.status, "claimed")
    assert.equal(takeover.receipt.ingestion_id, "ing_shared")
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
  } finally {
    await pool.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  }
})
