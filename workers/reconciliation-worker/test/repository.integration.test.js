import { randomUUID } from "node:crypto"
import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import pg from "pg"
import { createReconciliationRepository } from "../src/repository.js"

const databaseUrl = process.env.TEST_DATABASE_URL

function manifest(overrides = {}) {
  return {
    reconciliation_schema_version: "reconciliation-manifest.v1",
    snapshot_id: "orders-window-1",
    source_id: "source-one",
    entity_type: "ORDER",
    mode: "RECORD_LEVEL",
    as_of: "2026-09-03T00:10:00Z",
    coverage: {
      start_at: "2026-09-02T00:00:00Z",
      end_at: "2026-09-03T00:00:00Z",
      timezone: "Asia/Saigon",
      scope: { store_id: "store-one" },
    },
    closed: true,
    complete: true,
    closed_at: "2026-09-03T00:05:00Z",
    watermark: { at: "2026-09-03T00:00:00Z", grace_period_seconds: 300 },
    source_schema_version: "report.v1",
    semantic_version: "order-state.v1",
    records: [
      {
        entity_id: "order-1", version: "3", current_status: "COMPLETED",
        updated_at: "2026-09-02T12:00:00Z", committed_at: "2026-09-02T11:59:00Z",
        tombstone: false, money: { currency: "VND", amount: "125000.00" },
      },
      {
        entity_id: "order-2", version: "1", current_status: "PENDING",
        updated_at: "2026-09-02T13:00:00Z", tombstone: false,
        money: { currency: "VND", amount: "50000.00" },
      },
    ],
    control_totals: {
      record_count: 2,
      amounts: [{ currency: "VND", amount: "175000.00" }],
    },
    ...overrides,
  }
}

test("persists reconciliation evidence atomically and idempotently", { skip: !databaseUrl }, async () => {
  const schema = `reconciliation_${randomUUID().replaceAll("-", "")}`
  const admin = new pg.Pool({ connectionString: databaseUrl })
  await admin.query(`CREATE SCHEMA ${schema}`)
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
  try {
    for (const migrationName of ["010_reconciliation_evidence.sql", "011_reconciliation_comparison.sql"]) {
      const migration = await readFile(
        new URL(`../../../infra/postgres/v2/${migrationName}`, import.meta.url),
        "utf8",
      )
      await pool.query(migration)
      await pool.query(migration)
    }
    const repository = createReconciliationRepository({ pool })

    const recorded = await repository.recordSnapshot(manifest())
    assert.equal(recorded.status, "recorded")
    assert.equal(recorded.window_state, "RECONCILING")
    assert.equal(recorded.record_level_repair_allowed, true)
    assert.equal(recorded.record_count, 2)

    const duplicate = await repository.recordSnapshot(manifest())
    assert.equal(duplicate.status, "duplicate")
    assert.equal(duplicate.manifest_hash, recorded.manifest_hash)
    assert.deepEqual(await repository.getSnapshot({
      source_id: "source-one", snapshot_id: "orders-window-1",
    }), { ...recorded, status: "found" })

    const counts = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM reconciliation_snapshots) AS snapshots,
         (SELECT COUNT(*)::int FROM reconciliation_snapshot_records) AS records,
         (SELECT COUNT(*)::int FROM reconciliation_snapshot_amount_totals) AS amounts`,
    )
    assert.deepEqual(counts.rows[0], { snapshots: 1, records: 2, amounts: 1 })

    const analyticsProjection = {
      source_id: "source-one",
      entity_type: "ORDER",
      as_of: "2026-09-03T00:11:00Z",
      coverage: manifest().coverage,
      records: [
        {
          entity_id: "order-1", version: "3", current_status: "PROCESSING",
          updated_at: "2026-09-02T12:00:00Z", tombstone: false,
          money: { currency: "VND", amount: "120000.00" },
        },
        {
          entity_id: "order-3", version: "1", current_status: "COMPLETED",
          updated_at: "2026-09-02T14:00:00Z", tombstone: false,
          money: { currency: "VND", amount: "10000.00" },
        },
      ],
      control_totals: { record_count: 2, amounts: [{ currency: "VND", amount: "130000.00" }] },
    }
    const comparison = await repository.recordComparison({
      comparison_id: "comparison-1", source_id: "source-one", snapshot_id: "orders-window-1",
      observed_at: "2026-09-03T00:12:00Z", analytics_projection: analyticsProjection,
    })
    assert.equal(comparison.status, "recorded")
    assert.equal(comparison.comparison_revision, 1)
    assert.equal(comparison.window_state, "RECONCILING")
    assert.equal(comparison.missing_count, 1)
    assert.equal(comparison.phantom_count, 1)
    assert.equal(comparison.state_mismatch_count, 1)
    assert.equal(comparison.amount_mismatch_count, 1)
    assert.equal((await repository.recordComparison({
      comparison_id: "comparison-1", source_id: "source-one", snapshot_id: "orders-window-1",
      observed_at: "2026-09-03T00:12:00Z", analytics_projection: analyticsProjection,
    })).status, "duplicate")

    const reconciled = await repository.recordComparison({
      comparison_id: "comparison-2", source_id: "source-one", snapshot_id: "orders-window-1",
      observed_at: "2026-09-03T00:13:00Z",
      analytics_projection: {
        ...analyticsProjection,
        as_of: "2026-09-03T00:13:00Z",
        records: manifest().records,
        control_totals: manifest().control_totals,
      },
    })
    assert.equal(reconciled.comparison_revision, 2)
    assert.equal(reconciled.window_state, "RECONCILED")

    const comparisonCounts = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM reconciliation_comparisons) AS comparisons,
         (SELECT COUNT(*)::int FROM reconciliation_analytics_observations) AS observations,
         (SELECT COUNT(*)::int FROM reconciliation_discrepancies) AS discrepancies`,
    )
    assert.deepEqual(comparisonCounts.rows[0], { comparisons: 2, observations: 4, discrepancies: 4 })

    await assert.rejects(
      () => repository.recordSnapshot(manifest({ semantic_version: "order-state.v2" })),
      /different immutable manifest/,
    )
    await assert.rejects(
      () => repository.recordComparison({
        comparison_id: "comparison-1", source_id: "source-one", snapshot_id: "orders-window-1",
        observed_at: "2026-09-03T00:12:00Z",
        analytics_projection: { ...analyticsProjection, as_of: "2026-09-03T00:14:00Z" },
      }),
      /different immutable input/,
    )
    await assert.rejects(
      () => pool.query(`UPDATE reconciliation_snapshots SET complete = false
                         WHERE source_id = 'source-one' AND snapshot_id = 'orders-window-1'`),
      /append-only/,
    )
    await assert.rejects(
      () => pool.query(`DELETE FROM reconciliation_snapshot_records
                         WHERE source_id = 'source-one' AND snapshot_id = 'orders-window-1'`),
      /append-only/,
    )
    await assert.rejects(
      () => pool.query("DELETE FROM reconciliation_discrepancies WHERE comparison_id = 'comparison-1'"),
      /append-only/,
    )
  } finally {
    await pool.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  }
})

test("persists aggregate-only limitation without record-level repair capability", { skip: !databaseUrl }, async () => {
  const schema = `reconciliation_${randomUUID().replaceAll("-", "")}`
  const admin = new pg.Pool({ connectionString: databaseUrl })
  await admin.query(`CREATE SCHEMA ${schema}`)
  const pool = new pg.Pool({ connectionString: databaseUrl, options: `-c search_path=${schema}` })
  try {
    for (const migrationName of ["010_reconciliation_evidence.sql", "011_reconciliation_comparison.sql"]) {
      await pool.query(await readFile(
        new URL(`../../../infra/postgres/v2/${migrationName}`, import.meta.url),
        "utf8",
      ))
    }
    const repository = createReconciliationRepository({ pool })
    const result = await repository.recordSnapshot(manifest({
      snapshot_id: "orders-aggregate-1",
      mode: "AGGREGATE_ONLY",
      records: [],
      control_totals: { record_count: 5, amounts: [{ currency: "VND", amount: "500000.00" }] },
    }))
    assert.equal(result.window_state, "DEGRADED")
    assert.equal(result.limitation_reason, "AGGREGATE_ONLY")
    assert.equal(result.aggregate_comparison_allowed, true)
    assert.equal(result.record_level_comparison_allowed, false)
    assert.equal(result.record_level_repair_allowed, false)
    const comparison = await repository.recordComparison({
      comparison_id: "comparison-aggregate-1",
      source_id: "source-one",
      snapshot_id: "orders-aggregate-1",
      observed_at: "2026-09-03T00:12:00Z",
      analytics_projection: {
        source_id: "source-one",
        entity_type: "ORDER",
        as_of: "2026-09-03T00:11:00Z",
        coverage: manifest().coverage,
        records: Array.from({ length: 5 }, (_, index) => ({
          entity_id: `analytics-order-${index + 1}`,
          version: "1",
          current_status: "COMPLETED",
          tombstone: false,
        })),
        control_totals: {
          record_count: 5,
          amounts: [{ currency: "VND", amount: "500000.00" }],
        },
      },
    })
    assert.equal(comparison.window_state, "DEGRADED")
    assert.equal(comparison.limitation_reason, "AGGREGATE_ONLY")
    assert.equal(comparison.record_level_metrics_available, false)
    assert.equal(comparison.missing_count, null)
  } finally {
    await pool.end()
    await admin.query(`DROP SCHEMA ${schema} CASCADE`)
    await admin.end()
  }
})
