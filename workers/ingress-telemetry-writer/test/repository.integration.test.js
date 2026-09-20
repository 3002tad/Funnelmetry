import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { readFile } from "node:fs/promises"
import test from "node:test"
import pg from "pg"
import { IngressTelemetryConflictError, createIngressTelemetryRepository } from "../src/repository.js"

const databaseUrl = process.env.TEST_DATABASE_URL

test("persists immutable receipts and versioned outcomes in PostgreSQL", { skip: !databaseUrl }, async () => {
  const pool = new pg.Pool({ connectionString: databaseUrl })
  const runId = randomUUID()
  const sourceId = `telemetry-${runId}`
  const eventId = `integration:${runId}`
  const repository = createIngressTelemetryRepository({ pool })
  const receipt = {
    status: "accepted",
    source_id: sourceId,
    event_id: eventId,
    ingestion_id: `ing-${runId}`,
    ingestion_attempt_id: `attempt-${runId}`,
    received_at: "2026-09-01T01:00:00.000Z",
  }
  const normalized = {
    source_id: sourceId,
    source_event_id: eventId,
    status: "normalized",
    canonical_event_id: `can-${runId}`,
    mapping_version: "mapping-v1",
    processed_at: "2026-09-01T01:00:01.000Z",
    raw_record_id: receipt.ingestion_id,
  }
  const reprocessed = {
    ...normalized,
    canonical_event_id: `can-${runId}-v2`,
    mapping_version: "mapping-v2",
    processed_at: "2026-09-01T02:00:00.000Z",
  }

  try {
    await pool.query(await readFile(new URL("../../../infra/postgres/v2/005_ingress_telemetry.sql", import.meta.url), "utf8"))

    assert.equal((await repository.persistReceipt(receipt)).status, "inserted")
    assert.equal((await repository.persistReceipt(receipt)).status, "duplicate")
    assert.equal((await repository.persistOutcome(normalized)).status, "inserted")
    assert.equal((await repository.persistOutcome(normalized)).status, "duplicate")
    assert.equal((await repository.persistOutcome({ ...normalized, processed_at: '2026-09-20T00:00:00.000Z' })).status, 'duplicate')
    const original = await pool.query('SELECT outcome_document FROM canonicalization_outcomes WHERE source_id=$1 AND source_event_id=$2', [sourceId, eventId])
    assert.equal(original.rows[0].outcome_document.processed_at, normalized.processed_at)
    await assert.rejects(() => repository.persistOutcome({ ...normalized, raw_record_id: 'different-raw' }), IngressTelemetryConflictError)
    assert.equal((await repository.persistOutcome(reprocessed)).status, "inserted")

    await assert.rejects(
      () => repository.persistOutcome({
        ...normalized,
        status: "unsupported",
        canonical_event_id: undefined,
        reason_code: "mapping_not_found",
      }),
      IngressTelemetryConflictError,
    )

    const counts = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM ingress_accepted_receipts WHERE source_id = $1) AS receipts,
         (SELECT COUNT(*)::int FROM canonicalization_outcomes WHERE source_id = $1) AS outcomes`,
      [sourceId],
    )
    assert.deepEqual(counts.rows[0], { receipts: 1, outcomes: 2 })

    const latest = await pool.query(
      "SELECT mapping_version FROM canonicalization_latest_outcomes WHERE source_id = $1 AND source_event_id = $2",
      [sourceId, eventId],
    )
    assert.equal(latest.rows[0].mapping_version, "mapping-v2")
  } finally {
    await pool.end()
  }
})
