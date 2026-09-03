import {
  assessReconciliationCapability,
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
  })
}
