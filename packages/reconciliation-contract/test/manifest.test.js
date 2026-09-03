import test from "node:test"
import assert from "node:assert/strict"
import {
  assessReconciliationCapability,
  hashReconciliationManifest,
  validateReconciliationManifest,
} from "../src/index.js"

function manifest(overrides = {}) {
  return {
    reconciliation_schema_version: "reconciliation-manifest.v1",
    snapshot_id: "orders-2026-09-02",
    source_id: "medusa-reference",
    entity_type: "ORDER",
    mode: "RECORD_LEVEL",
    as_of: "2026-09-03T00:10:00Z",
    coverage: {
      start_at: "2026-09-02T00:00:00Z",
      end_at: "2026-09-03T00:00:00Z",
      timezone: "Asia/Saigon",
      scope: { store_id: "store-demo" },
    },
    closed: true,
    complete: true,
    closed_at: "2026-09-03T00:05:00Z",
    watermark: { at: "2026-09-03T00:00:00Z", grace_period_seconds: 300 },
    source_schema_version: "medusa-report.v1",
    semantic_version: "order-state.v1",
    records: [{
      entity_id: "order-1",
      version: "7",
      updated_at: "2026-09-02T12:00:00Z",
      current_status: "COMPLETED",
      money: { amount: "125000.00", currency: "VND" },
      tombstone: false,
    }],
    control_totals: {
      record_count: 1,
      amounts: [{ amount: "125000.00", currency: "VND" }],
    },
    ...overrides,
  }
}

test("normalizes a closed complete record-level manifest", () => {
  const result = validateReconciliationManifest(manifest())
  assert.equal(result.as_of, "2026-09-03T00:10:00.000Z")
  assert.equal(result.records[0].version, "7")
  assert.deepEqual(assessReconciliationCapability(result), {
    window_state: "RECONCILING",
    limitation_reason: null,
    aggregate_comparison_allowed: true,
    record_level_comparison_allowed: true,
    record_level_repair_allowed: true,
  })
})

test("keeps an open snapshot provisional and non-repairable", () => {
  const result = assessReconciliationCapability(manifest({ closed: false, closed_at: null }))
  assert.equal(result.window_state, "PROVISIONAL")
  assert.equal(result.limitation_reason, "SNAPSHOT_NOT_CLOSED")
  assert.equal(result.aggregate_comparison_allowed, false)
  assert.equal(result.record_level_repair_allowed, false)
})

test("degrades an incomplete snapshot", () => {
  const result = assessReconciliationCapability(manifest({ complete: false }))
  assert.equal(result.window_state, "DEGRADED")
  assert.equal(result.limitation_reason, "SNAPSHOT_INCOMPLETE")
})

test("allows only aggregate comparison for a closed aggregate-only snapshot", () => {
  const input = manifest({
    mode: "AGGREGATE_ONLY",
    records: [],
    control_totals: { record_count: 42, amounts: [{ currency: "VND", amount: "900000.00" }] },
  })
  assert.deepEqual(assessReconciliationCapability(input), {
    window_state: "DEGRADED",
    limitation_reason: "AGGREGATE_ONLY",
    aggregate_comparison_allowed: true,
    record_level_comparison_allowed: false,
    record_level_repair_allowed: false,
  })
})

test("requires version or updated time for every record", () => {
  const input = manifest({ records: [{ entity_id: "order-1", current_status: "COMPLETED" }] })
  assert.throws(() => validateReconciliationManifest(input), /must provide version or updated_at/)
})

test("requires record-level control count to match unique records", () => {
  assert.throws(
    () => validateReconciliationManifest(manifest({ control_totals: { record_count: 2, amounts: [] } })),
    /must equal records.length/,
  )
  const duplicate = manifest({ records: [manifest().records[0], manifest().records[0]], control_totals: {
    record_count: 2, amounts: [],
  } })
  assert.throws(() => validateReconciliationManifest(duplicate), /unique entity_id/)
})

test("rejects inconsistent coverage, closure and watermark boundaries", () => {
  assert.throws(
    () => validateReconciliationManifest(manifest({ as_of: "2026-09-02T23:00:00Z" })),
    /coverage.end_at must not be after as_of/,
  )
  assert.throws(
    () => validateReconciliationManifest(manifest({ closed: false })),
    /closed_at must be present exactly when closed is true/,
  )
  assert.throws(
    () => validateReconciliationManifest(manifest({ watermark: {
      at: "2026-09-03T00:11:00Z", grace_period_seconds: 300,
    } })),
    /watermark.at must not be after as_of/,
  )
})

test("requires paired amount and ISO currency without floating-point coercion", () => {
  const invalid = manifest({ records: [{
    ...manifest().records[0], money: { currency: "vnd", amount: 125000 },
  }] })
  assert.throws(() => validateReconciliationManifest(invalid), /ISO-4217 currency code/)
})

test("produces a deterministic hash independent of record and field-set order", () => {
  const second = {
    entity_id: "order-2", version: "1", current_status: "PENDING", tombstone: false,
    record_hash: { algorithm: "sha256", value: "a".repeat(64), field_set: ["status", "version"] },
  }
  const firstInput = manifest({
    records: [second, manifest().records[0]],
    control_totals: { record_count: 2, amounts: [] },
  })
  const secondInput = manifest({
    records: [manifest().records[0], {
      ...second, record_hash: { ...second.record_hash, field_set: ["version", "status"] },
    }],
    control_totals: { record_count: 2, amounts: [] },
  })
  assert.match(hashReconciliationManifest(firstInput), /^[a-f0-9]{64}$/)
  assert.equal(hashReconciliationManifest(firstInput), hashReconciliationManifest(secondInput))
})
