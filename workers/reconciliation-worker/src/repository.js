import {
  assessReconciliationCapability,
  compareReconciliationEvidence,
  hashReconciliationManifest,
  validateReconciliationManifest,
} from "@funnelmetry/reconciliation-contract"

function iso(value) {
  return value === null || value === undefined ? null : new Date(value).toISOString()
}

function snapshotResult(row, status) {
  return Object.freeze({
    status,
    source_id: row.source_id,
    snapshot_id: row.snapshot_id,
    entity_type: row.entity_type,
    reconciliation_mode: row.reconciliation_mode,
    as_of: iso(row.as_of),
    coverage_start_at: iso(row.coverage_start_at),
    coverage_end_at: iso(row.coverage_end_at),
    window_state: row.window_state,
    limitation_reason: row.limitation_reason,
    aggregate_comparison_allowed: row.aggregate_comparison_allowed,
    record_level_comparison_allowed: row.record_level_comparison_allowed,
    record_level_repair_allowed: row.record_level_repair_allowed,
    record_count: Number(row.record_count),
    manifest_hash: row.manifest_hash,
    recorded_at: iso(row.recorded_at),
  })
}

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function timestamp(value, field) {
  const normalized = requiredString(value, field)
  if (Number.isNaN(Date.parse(normalized))) throw new Error(`${field} must be an ISO-8601 timestamp`)
  return new Date(normalized).toISOString()
}

function comparisonResult(row, status) {
  return Object.freeze({
    status,
    comparison_id: row.comparison_id,
    source_id: row.source_id,
    snapshot_id: row.snapshot_id,
    comparison_revision: Number(row.comparison_revision),
    observed_at: iso(row.observed_at),
    analytics_as_of: iso(row.analytics_as_of),
    window_state: row.window_state,
    limitation_reason: row.limitation_reason,
    record_level_metrics_available: row.record_level_metrics_available,
    source_count: Number(row.source_count),
    analytics_count: Number(row.analytics_count),
    source_denominator_empty: row.source_denominator_empty,
    analytics_denominator_empty: row.analytics_denominator_empty,
    control_total_mismatch: row.control_total_mismatch,
    missing_count: row.missing_count === null ? null : Number(row.missing_count),
    phantom_count: row.phantom_count === null ? null : Number(row.phantom_count),
    state_mismatch_count: row.state_mismatch_count === null ? null : Number(row.state_mismatch_count),
    amount_mismatch_count: row.amount_mismatch_count === null ? null : Number(row.amount_mismatch_count),
    missing_rate: row.missing_rate,
    phantom_rate: row.phantom_rate,
    state_mismatch_rate: row.state_mismatch_rate,
    amount_mismatch_rate: row.amount_mismatch_rate,
    revenue_deviation: row.revenue_deviation,
    evidence_hash: row.evidence_hash,
    recorded_at: iso(row.recorded_at),
  })
}

function validateComparisonRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("reconciliation comparison request must be an object")
  }
  return Object.freeze({
    comparison_id: requiredString(input.comparison_id, "comparison_id"),
    source_id: requiredString(input.source_id, "source_id"),
    snapshot_id: requiredString(input.snapshot_id, "snapshot_id"),
    observed_at: timestamp(input.observed_at, "observed_at"),
    analytics_projection: input.analytics_projection,
  })
}

export function createReconciliationRepository({ pool } = {}) {
  if (!pool || typeof pool.connect !== "function") throw new Error("PostgreSQL pool is required")

  return Object.freeze({
    async recordSnapshot(input) {
      const manifest = validateReconciliationManifest(input)
      const capability = assessReconciliationCapability(manifest)
      const manifestHash = hashReconciliationManifest(manifest)
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        const inserted = await client.query(
          `INSERT INTO reconciliation_snapshots (
             source_id, snapshot_id, entity_type, reconciliation_mode, as_of,
             coverage_start_at, coverage_end_at, coverage_timezone, coverage_scope,
             closed, complete, closed_at, watermark_at, watermark_grace_seconds,
             source_schema_version, semantic_version, window_state, limitation_reason,
             aggregate_comparison_allowed, record_level_comparison_allowed,
             record_level_repair_allowed, record_count, control_totals,
             manifest_hash, manifest_document
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16,$17,$18,
             $19,$20,$21,$22,$23::jsonb,$24,$25::jsonb
           )
           ON CONFLICT (source_id, snapshot_id) DO NOTHING
           RETURNING *`,
          [
            manifest.source_id, manifest.snapshot_id, manifest.entity_type, manifest.mode,
            manifest.as_of, manifest.coverage.start_at, manifest.coverage.end_at,
            manifest.coverage.timezone, JSON.stringify(manifest.coverage.scope),
            manifest.closed, manifest.complete, manifest.closed_at, manifest.watermark.at,
            manifest.watermark.grace_period_seconds, manifest.source_schema_version,
            manifest.semantic_version, capability.window_state, capability.limitation_reason,
            capability.aggregate_comparison_allowed, capability.record_level_comparison_allowed,
            capability.record_level_repair_allowed, manifest.control_totals.record_count,
            JSON.stringify(manifest.control_totals), manifestHash, JSON.stringify(manifest),
          ],
        )
        if (inserted.rowCount === 0) {
          const existing = await client.query(
            `SELECT * FROM reconciliation_snapshots
              WHERE source_id = $1 AND snapshot_id = $2
              FOR UPDATE`,
            [manifest.source_id, manifest.snapshot_id],
          )
          if (existing.rows[0]?.manifest_hash !== manifestHash) {
            throw new Error("snapshot identity already exists with different immutable manifest")
          }
          await client.query("COMMIT")
          return snapshotResult(existing.rows[0], "duplicate")
        }

        for (const record of manifest.records) {
          await client.query(
            `INSERT INTO reconciliation_snapshot_records (
               source_id, snapshot_id, entity_id, current_status, entity_version,
               source_updated_at, source_occurred_at, source_committed_at, tombstone,
               amount, currency, record_hash, record_hash_metadata, record_document
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb)`,
            [
              manifest.source_id, manifest.snapshot_id, record.entity_id, record.current_status,
              record.version ?? null, record.updated_at ?? null, record.occurred_at ?? null,
              record.committed_at ?? null, record.tombstone, record.money?.amount ?? null,
              record.money?.currency ?? null, record.record_hash?.value ?? null,
              record.record_hash ? JSON.stringify(record.record_hash) : null,
              JSON.stringify(record),
            ],
          )
        }
        for (const total of manifest.control_totals.amounts) {
          await client.query(
            `INSERT INTO reconciliation_snapshot_amount_totals (
               source_id, snapshot_id, currency, amount
             ) VALUES ($1,$2,$3,$4)`,
            [manifest.source_id, manifest.snapshot_id, total.currency, total.amount],
          )
        }
        await client.query("COMMIT")
        return snapshotResult(inserted.rows[0], "recorded")
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      } finally {
        client.release()
      }
    },

    async getSnapshot({ source_id: sourceId, snapshot_id: snapshotId } = {}) {
      if (typeof sourceId !== "string" || !sourceId.trim()) throw new Error("source_id is required")
      if (typeof snapshotId !== "string" || !snapshotId.trim()) throw new Error("snapshot_id is required")
      const result = await pool.query(
        `SELECT * FROM reconciliation_snapshots WHERE source_id = $1 AND snapshot_id = $2`,
        [sourceId.trim(), snapshotId.trim()],
      )
      return result.rows[0] ? snapshotResult(result.rows[0], "found") : null
    },

    async recordComparison(input) {
      const request = validateComparisonRequest(input)
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        const snapshotResultSet = await client.query(
          `SELECT manifest_document FROM reconciliation_snapshots
            WHERE source_id = $1 AND snapshot_id = $2
            FOR UPDATE`,
          [request.source_id, request.snapshot_id],
        )
        if (!snapshotResultSet.rows[0]) throw new Error("reconciliation snapshot was not found")
        const comparison = compareReconciliationEvidence({
          manifest: snapshotResultSet.rows[0].manifest_document,
          analytics_projection: request.analytics_projection,
        })
        const existing = await client.query(
          `SELECT * FROM reconciliation_comparisons WHERE comparison_id = $1`,
          [request.comparison_id],
        )
        if (existing.rows[0]) {
          const row = existing.rows[0]
          if (row.source_id !== request.source_id
            || row.snapshot_id !== request.snapshot_id
            || iso(row.observed_at) !== request.observed_at
            || row.evidence_hash !== comparison.evidence_hash) {
            throw new Error("comparison_id already exists with different immutable input")
          }
          await client.query("COMMIT")
          return comparisonResult(row, "duplicate")
        }
        const revisionResult = await client.query(
          `SELECT COALESCE(MAX(comparison_revision), 0) + 1 AS revision
             FROM reconciliation_comparisons
            WHERE source_id = $1 AND snapshot_id = $2`,
          [request.source_id, request.snapshot_id],
        )
        const revision = Number(revisionResult.rows[0].revision)
        const inserted = await client.query(
          `INSERT INTO reconciliation_comparisons (
             comparison_id, source_id, snapshot_id, comparison_revision, observed_at,
             analytics_as_of, window_state, limitation_reason, record_level_metrics_available,
             source_count, analytics_count, source_denominator_empty, analytics_denominator_empty,
             control_total_mismatch, missing_count, phantom_count, state_mismatch_count,
             amount_mismatch_count, missing_rate, phantom_rate, state_mismatch_rate,
             amount_mismatch_rate, revenue_deviation, evidence_hash, comparison_document
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
             $22,$23::jsonb,$24,$25::jsonb
           ) RETURNING *`,
          [
            request.comparison_id, request.source_id, request.snapshot_id, revision,
            request.observed_at, comparison.analytics_as_of, comparison.window_state,
            comparison.limitation_reason, comparison.record_level_metrics_available,
            comparison.source_count, comparison.analytics_count, comparison.source_denominator_empty,
            comparison.analytics_denominator_empty, comparison.control_total_mismatch,
            comparison.missing_count, comparison.phantom_count, comparison.state_mismatch_count,
            comparison.amount_mismatch_count, comparison.missing_rate, comparison.phantom_rate,
            comparison.state_mismatch_rate, comparison.amount_mismatch_rate,
            JSON.stringify(comparison.revenue_deviation), comparison.evidence_hash,
            JSON.stringify(comparison),
          ],
        )
        for (const record of comparison.analytics_projection.records) {
          await client.query(
            `INSERT INTO reconciliation_analytics_observations (
               comparison_id, entity_id, current_status, entity_version, analytics_updated_at,
               analytics_occurred_at, analytics_committed_at, tombstone, amount, currency,
               observation_document
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
            [
              request.comparison_id, record.entity_id, record.current_status, record.version ?? null,
              record.updated_at ?? null, record.occurred_at ?? null, record.committed_at ?? null,
              record.tombstone, record.money?.amount ?? null, record.money?.currency ?? null,
              JSON.stringify(record),
            ],
          )
        }
        for (const discrepancy of comparison.discrepancies) {
          await client.query(
            `INSERT INTO reconciliation_discrepancies (
               comparison_id, discrepancy_kind, entity_id, source_record, analytics_record
             ) VALUES ($1,$2,$3,$4::jsonb,$5::jsonb)`,
            [
              request.comparison_id, discrepancy.kind, discrepancy.entity_id,
              discrepancy.source_record ? JSON.stringify(discrepancy.source_record) : null,
              discrepancy.analytics_record ? JSON.stringify(discrepancy.analytics_record) : null,
            ],
          )
        }
        await client.query("COMMIT")
        return comparisonResult(inserted.rows[0], "recorded")
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      } finally {
        client.release()
      }
    },
  })
}
