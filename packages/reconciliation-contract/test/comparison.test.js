import test from "node:test"
import assert from "node:assert/strict"
import { compareReconciliationEvidence } from "../src/index.js"

const coverage = {
  start_at: "2026-09-02T00:00:00Z",
  end_at: "2026-09-03T00:00:00Z",
  timezone: "Asia/Saigon",
  scope: { store_id: "store-one" },
}

function record(entityId, status, amount, version = "1") {
  return {
    entity_id: entityId,
    version,
    current_status: status,
    tombstone: false,
    money: { currency: "VND", amount },
  }
}

function manifest(overrides = {}) {
  const records = [record("order-1", "COMPLETED", "100.00"), record("order-2", "PENDING", "50.00")]
  return {
    reconciliation_schema_version: "reconciliation-manifest.v1",
    snapshot_id: "orders-window-1",
    source_id: "source-one",
    entity_type: "ORDER",
    mode: "RECORD_LEVEL",
    as_of: "2026-09-03T00:10:00Z",
    coverage,
    closed: true,
    complete: true,
    closed_at: "2026-09-03T00:05:00Z",
    watermark: { at: "2026-09-03T00:00:00Z", grace_period_seconds: 300 },
    source_schema_version: "report.v1",
    semantic_version: "order-state.v1",
    records,
    control_totals: { record_count: records.length, amounts: [{ currency: "VND", amount: "150.00" }] },
    ...overrides,
  }
}

function analytics(records, amounts = [{ currency: "VND", amount: "150.00" }], overrides = {}) {
  return {
    source_id: "source-one",
    entity_type: "ORDER",
    as_of: "2026-09-03T00:11:00Z",
    coverage,
    records,
    control_totals: { record_count: records.length, amounts },
    ...overrides,
  }
}

test("detects missing, phantom, state and amount discrepancies separately", () => {
  const result = compareReconciliationEvidence({
    manifest: manifest(),
    analytics_projection: analytics([
      record("order-1", "PROCESSING", "90.00"),
      record("order-3", "COMPLETED", "10.00"),
    ], [{ currency: "VND", amount: "100.00" }]),
  })
  assert.equal(result.window_state, "RECONCILING")
  assert.deepEqual(
    result.discrepancies.map((item) => `${item.kind}:${item.entity_id}`),
    ["STATE_MISMATCH:order-1", "AMOUNT_MISMATCH:order-1", "MISSING:order-2", "PHANTOM:order-3"],
  )
  assert.equal(result.missing_count, 1)
  assert.equal(result.phantom_count, 1)
  assert.equal(result.state_mismatch_count, 1)
  assert.equal(result.amount_mismatch_count, 1)
  assert.equal(result.missing_rate, 0.5)
  assert.equal(result.phantom_rate, 0.5)
  assert.deepEqual(result.revenue_deviation, [{
    currency: "VND",
    source_amount: "150.00",
    analytics_amount: "100.00",
    absolute_deviation: "50",
    deviation_rate: "0.333333333333",
    denominator_empty: false,
  }])
})

test("marks an exact closed record-level comparison reconciled", () => {
  const source = manifest()
  const result = compareReconciliationEvidence({
    manifest: source,
    analytics_projection: analytics([...source.records].reverse()),
  })
  assert.equal(result.window_state, "RECONCILED")
  assert.equal(result.control_total_mismatch, false)
  assert.deepEqual(result.discrepancies, [])
  assert.match(result.evidence_hash, /^[a-f0-9]{64}$/)
})

test("reports empty denominators instead of inventing rates", () => {
  const source = manifest({
    records: [],
    control_totals: { record_count: 0, amounts: [{ currency: "VND", amount: "0.00" }] },
  })
  const result = compareReconciliationEvidence({
    manifest: source,
    analytics_projection: analytics([], [{ currency: "VND", amount: "0" }]),
  })
  assert.equal(result.window_state, "RECONCILED")
  assert.equal(result.source_denominator_empty, true)
  assert.equal(result.analytics_denominator_empty, true)
  assert.equal(result.missing_rate, null)
  assert.equal(result.phantom_rate, null)
  assert.equal(result.revenue_deviation[0].deviation_rate, null)
  assert.equal(result.revenue_deviation[0].denominator_empty, true)
})

test("keeps aggregate-only comparison degraded without record metrics", () => {
  const source = manifest({
    mode: "AGGREGATE_ONLY",
    records: [],
    control_totals: { record_count: 2, amounts: [{ currency: "VND", amount: "150" }] },
  })
  const result = compareReconciliationEvidence({
    manifest: source,
    analytics_projection: analytics([record("order-1", "COMPLETED", "150")]),
  })
  assert.equal(result.window_state, "DEGRADED")
  assert.equal(result.limitation_reason, "AGGREGATE_ONLY")
  assert.equal(result.record_level_metrics_available, false)
  assert.equal(result.missing_count, null)
  assert.equal(result.phantom_count, null)
  assert.equal(result.control_total_mismatch, true)
})

test("rejects open snapshots and mismatched analytics scope", () => {
  assert.throws(() => compareReconciliationEvidence({
    manifest: manifest({ closed: false, closed_at: null }),
    analytics_projection: analytics([]),
  }), /must be closed/)
  assert.throws(() => compareReconciliationEvidence({
    manifest: manifest(),
    analytics_projection: analytics(manifest().records, undefined, {
      coverage: { ...coverage, scope: { store_id: "another-store" } },
    }),
  }), /coverage does not match/)
})

test("compares decimal money exactly without floating-point coercion", () => {
  const source = manifest({
    records: [record("order-1", "COMPLETED", "9007199254740993.10")],
    control_totals: { record_count: 1, amounts: [{ currency: "VND", amount: "9007199254740993.10" }] },
  })
  const result = compareReconciliationEvidence({
    manifest: source,
    analytics_projection: analytics(
      [record("order-1", "COMPLETED", "9007199254740993.11")],
      [{ currency: "VND", amount: "9007199254740993.11" }],
    ),
  })
  assert.equal(result.amount_mismatch_count, 1)
  assert.equal(result.revenue_deviation[0].absolute_deviation, "0.01")
})
