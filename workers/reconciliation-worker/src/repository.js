import { createHash } from "node:crypto"
import {
  assessReconciliationCapability,
  compareReconciliationEvidence,
  hashReconciliationAnalyticsProjection,
  hashReconciliationCoverage,
  hashReconciliationManifest,
  validateReconciliationAnalyticsProjection,
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

function validateProjectionRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("current projection request must be an object")
  }
  return Object.freeze({
    projection_id: requiredString(input.projection_id, "projection_id"),
    projection: validateReconciliationAnalyticsProjection(input.analytics_projection),
  })
}

function validateRepairRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("reconciliation repair request must be an object")
  }
  return Object.freeze({
    repair_id: requiredString(input.repair_id, "repair_id"),
    comparison_id: requiredString(input.comparison_id, "comparison_id"),
    repaired_at: timestamp(input.repaired_at, "repaired_at"),
  })
}

function validateVerificationRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("repair verification request must be an object")
  }
  return Object.freeze({
    repair_id: requiredString(input.repair_id, "repair_id"),
    comparison_id: requiredString(input.comparison_id, "comparison_id"),
    verified_at: timestamp(input.verified_at, "verified_at"),
  })
}

function projectionResult(row, status) {
  return Object.freeze({
    status,
    projection_id: row.projection_id,
    source_id: row.source_id,
    entity_type: row.entity_type,
    coverage_key: row.coverage_key,
    projection_revision: Number(row.projection_revision),
    as_of: iso(row.as_of),
    origin: row.origin,
    comparison_id: row.comparison_id,
    record_count: Number(row.record_count),
    projection_hash: row.projection_hash,
    recorded_at: iso(row.recorded_at),
  })
}

function repairResult(row, status) {
  return Object.freeze({
    status,
    repair_id: row.repair_id,
    comparison_id: row.comparison_id,
    source_id: row.source_id,
    snapshot_id: row.snapshot_id,
    before_projection_id: row.before_projection_id,
    after_projection_id: row.after_projection_id,
    repaired_at: iso(row.repaired_at),
    correction_count: Number(row.correction_count),
    repair_hash: row.repair_hash,
    recorded_at: iso(row.recorded_at),
  })
}

function verificationResult(row, status) {
  return Object.freeze({
    status,
    repair_id: row.repair_id,
    comparison_id: row.verification_comparison_id,
    verified_at: iso(row.verified_at),
    attempted_correction_count: Number(row.attempted_correction_count),
    successful_correction_count: Number(row.successful_correction_count),
    denominator_empty: row.denominator_empty,
    repair_success_rate: row.repair_success_rate,
    current_projection_converged: row.current_projection_converged,
    verification_hash: row.verification_hash,
    recorded_at: iso(row.recorded_at),
  })
}

async function currentProjection(
  client,
  { source_id: sourceId, entity_type: entityType, as_of: asOf, coverage },
  { lock = false } = {},
) {
  const coverageKey = hashReconciliationCoverage({ source_id: sourceId, entity_type: entityType, as_of: asOf, coverage })
  if (lock) await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [coverageKey])
  const result = await client.query(
    `SELECT revision.*, head.projection_id AS head_projection_id
       FROM analytics_current_projection_heads head
       JOIN analytics_current_projection_revisions revision
         ON revision.projection_id = head.projection_id
      WHERE head.source_id = $1 AND head.entity_type = $2 AND head.coverage_key = $3`,
    [sourceId, entityType, coverageKey],
  )
  return result.rows[0] ?? null
}

async function insertProjection(client, { projectionId, projection, origin, comparisonId = null }) {
  const coverageKey = hashReconciliationCoverage(projection)
  const projectionHash = hashReconciliationAnalyticsProjection(projection)
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [coverageKey])
  const existing = await client.query(
    "SELECT * FROM analytics_current_projection_revisions WHERE projection_id = $1",
    [projectionId],
  )
  if (existing.rows[0]) {
    const row = existing.rows[0]
    if (row.projection_hash !== projectionHash || row.origin !== origin || row.comparison_id !== comparisonId) {
      throw new Error("projection_id already exists with different immutable input")
    }
    return projectionResult(row, "duplicate")
  }
  const head = await currentProjection(client, projection)
  if (head && Date.parse(projection.as_of) < Date.parse(head.as_of)) {
    throw new Error("current projection as_of must not move backwards")
  }
  const revisionResult = await client.query(
    `SELECT COALESCE(MAX(projection_revision), 0) + 1 AS revision
       FROM analytics_current_projection_revisions
      WHERE source_id = $1 AND entity_type = $2 AND coverage_key = $3`,
    [projection.source_id, projection.entity_type, coverageKey],
  )
  const revision = Number(revisionResult.rows[0].revision)
  const inserted = await client.query(
    `INSERT INTO analytics_current_projection_revisions (
       projection_id, source_id, entity_type, coverage_key, projection_revision, as_of,
       coverage_start_at, coverage_end_at, coverage_timezone, coverage_scope, origin,
       comparison_id, record_count, control_totals, projection_hash, projection_document
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14::jsonb,$15,$16::jsonb)
     RETURNING *`,
    [
      projectionId, projection.source_id, projection.entity_type, coverageKey, revision,
      projection.as_of, projection.coverage.start_at, projection.coverage.end_at,
      projection.coverage.timezone, JSON.stringify(projection.coverage.scope), origin,
      comparisonId, projection.control_totals.record_count,
      JSON.stringify(projection.control_totals), projectionHash, JSON.stringify(projection),
    ],
  )
  for (const record of projection.records) {
    await client.query(
      `INSERT INTO analytics_current_projection_records (
         projection_id, entity_id, current_status, entity_version, analytics_updated_at,
         analytics_occurred_at, analytics_committed_at, tombstone, amount, currency, record_document
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)`,
      [
        projectionId, record.entity_id, record.current_status, record.version ?? null,
        record.updated_at ?? null, record.occurred_at ?? null, record.committed_at ?? null,
        record.tombstone, record.money?.amount ?? null, record.money?.currency ?? null,
        JSON.stringify(record),
      ],
    )
  }
  await client.query(
    `INSERT INTO analytics_current_projection_heads (
       source_id, entity_type, coverage_key, projection_id, projection_revision
     ) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (source_id, entity_type, coverage_key) DO UPDATE SET
       projection_id = EXCLUDED.projection_id,
       projection_revision = EXCLUDED.projection_revision,
       advanced_at = NOW()`,
    [projection.source_id, projection.entity_type, coverageKey, projectionId, revision],
  )
  return projectionResult(inserted.rows[0], "recorded")
}

export function createReconciliationRepository({ pool } = {}) {
  if (!pool || typeof pool.connect !== "function") throw new Error("PostgreSQL pool is required")

  return Object.freeze({
    async recordCurrentProjection(input) {
      const request = validateProjectionRequest(input)
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        const result = await insertProjection(client, {
          projectionId: request.projection_id,
          projection: request.projection,
          origin: "PIPELINE",
        })
        await client.query("COMMIT")
        return result
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      } finally {
        client.release()
      }
    },

    async getCurrentProjection(input) {
      if (!input || typeof input !== "object" || Array.isArray(input)) {
        throw new Error("current projection lookup must be an object")
      }
      const descriptor = {
        source_id: input.source_id,
        entity_type: input.entity_type,
        as_of: input.as_of,
        coverage: input.coverage,
      }
      hashReconciliationCoverage(descriptor)
      const row = await currentProjection(pool, descriptor)
      if (!row) return null
      return Object.freeze({
        ...projectionResult(row, "found"),
        analytics_projection: row.projection_document,
      })
    },

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
        let analyticsProjection = request.analytics_projection
        if (analyticsProjection === undefined) {
          const replay = await client.query(
            "SELECT * FROM reconciliation_comparisons WHERE comparison_id = $1",
            [request.comparison_id],
          )
          if (replay.rows[0]) {
            const replayRow = replay.rows[0]
            if (replayRow.source_id !== request.source_id
              || replayRow.snapshot_id !== request.snapshot_id
              || iso(replayRow.observed_at) !== request.observed_at) {
              throw new Error("comparison_id already exists with different immutable input")
            }
            await client.query("COMMIT")
            return comparisonResult(replayRow, "duplicate")
          }
          const manifest = validateReconciliationManifest(snapshotResultSet.rows[0].manifest_document)
          const current = await currentProjection(client, manifest)
          if (!current) throw new Error("analytics current projection was not found for snapshot scope")
          analyticsProjection = current.projection_document
        }
        const comparison = compareReconciliationEvidence({
          manifest: snapshotResultSet.rows[0].manifest_document,
          analytics_projection: analyticsProjection,
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

    async repairComparison(input) {
      const request = validateRepairRequest(input)
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`reconciliation-repair:${request.repair_id}`],
        )
        const existing = await client.query("SELECT * FROM reconciliation_repairs WHERE repair_id = $1", [request.repair_id])
        if (existing.rows[0]) {
          const row = existing.rows[0]
          if (row.comparison_id !== request.comparison_id || iso(row.repaired_at) !== request.repaired_at) {
            throw new Error("repair_id already exists with different immutable input")
          }
          await client.query("COMMIT")
          return repairResult(row, "duplicate")
        }
        const evidence = await client.query(
          `SELECT comparison.*, snapshot.manifest_document, snapshot.record_level_repair_allowed
             FROM reconciliation_comparisons comparison
             JOIN reconciliation_snapshots snapshot
               ON snapshot.source_id = comparison.source_id
              AND snapshot.snapshot_id = comparison.snapshot_id
            WHERE comparison.comparison_id = $1
            FOR UPDATE OF comparison`,
          [request.comparison_id],
        )
        if (!evidence.rows[0]) throw new Error("reconciliation comparison was not found")
        const row = evidence.rows[0]
        if (row.window_state !== "RECONCILING" || !row.record_level_metrics_available
          || !row.record_level_repair_allowed) {
          throw new Error("comparison does not allow record-level current projection repair")
        }
        const manifest = validateReconciliationManifest(row.manifest_document)
        if (Date.parse(request.repaired_at) < Date.parse(manifest.as_of)) {
          throw new Error("repaired_at must not be before snapshot as_of")
        }
        const before = await currentProjection(client, manifest, { lock: true })
        if (!before) throw new Error("analytics current projection was not found for snapshot scope")
        const comparedProjection = row.comparison_document.analytics_projection
        if (before.projection_hash !== hashReconciliationAnalyticsProjection(comparedProjection)) {
          throw new Error("comparison is stale because current projection has advanced")
        }
        const discrepancies = row.comparison_document.discrepancies
        const grouped = new Map()
        for (const discrepancy of discrepancies) {
          const value = grouped.get(discrepancy.entity_id) ?? {
            entity_id: discrepancy.entity_id,
            before_record: discrepancy.analytics_record,
            after_record: discrepancy.source_record,
            discrepancy_kinds: [],
          }
          value.discrepancy_kinds.push(discrepancy.kind)
          if (discrepancy.analytics_record) value.before_record = discrepancy.analytics_record
          if (discrepancy.source_record) value.after_record = discrepancy.source_record
          grouped.set(discrepancy.entity_id, value)
        }
        const corrections = [...grouped.values()].sort((left, right) => left.entity_id.localeCompare(right.entity_id))
          .map((correction) => ({
            ...correction,
            correction_action: correction.after_record ? "UPSERT" : "REMOVE",
            discrepancy_kinds: [...new Set(correction.discrepancy_kinds)].sort(),
          }))
        for (const correction of corrections) {
          if (!correction.before_record || !correction.after_record) continue
          if (correction.before_record.version === correction.after_record.version) continue
          const sourceUpdatedAt = correction.after_record.updated_at
          const analyticsUpdatedAt = correction.before_record.updated_at
          if (!sourceUpdatedAt || !analyticsUpdatedAt) {
            throw new Error(`cannot prove authoritative version ordering for ${correction.entity_id}`)
          }
          if (Date.parse(sourceUpdatedAt) < Date.parse(analyticsUpdatedAt)) {
            throw new Error(`authoritative snapshot record is older than current projection for ${correction.entity_id}`)
          }
        }
        const repairedProjection = validateReconciliationAnalyticsProjection({
          source_id: manifest.source_id,
          entity_type: manifest.entity_type,
          as_of: request.repaired_at,
          coverage: manifest.coverage,
          records: manifest.records,
          control_totals: manifest.control_totals,
        })
        const afterProjectionId = `${request.repair_id}:projection`
        const after = await insertProjection(client, {
          projectionId: afterProjectionId,
          projection: repairedProjection,
          origin: "RECONCILIATION_CORRECTION",
          comparisonId: request.comparison_id,
        })
        if (after.status !== "recorded") throw new Error("repair projection already exists without repair evidence")
        const repairDocument = {
          repair_id: request.repair_id,
          comparison_id: request.comparison_id,
          source_id: manifest.source_id,
          snapshot_id: manifest.snapshot_id,
          repaired_at: request.repaired_at,
          before_projection_id: before.projection_id,
          before_projection_hash: before.projection_hash,
          after_projection_id: after.projection_id,
          after_projection_hash: after.projection_hash,
          corrections,
        }
        const repairHash = createHash("sha256").update(JSON.stringify(repairDocument)).digest("hex")
        const inserted = await client.query(
          `INSERT INTO reconciliation_repairs (
             repair_id, comparison_id, source_id, snapshot_id, before_projection_id,
             after_projection_id, repaired_at, correction_count, repair_hash, repair_document
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
           RETURNING *`,
          [
            request.repair_id, request.comparison_id, manifest.source_id, manifest.snapshot_id,
            before.projection_id, after.projection_id, request.repaired_at, corrections.length,
            repairHash, JSON.stringify(repairDocument),
          ],
        )
        for (const correction of corrections) {
          await client.query(
            `INSERT INTO reconciliation_corrections (
               repair_id, entity_id, correction_action, discrepancy_kinds, before_record, after_record
             ) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)`,
            [
              request.repair_id, correction.entity_id, correction.correction_action,
              correction.discrepancy_kinds,
              correction.before_record ? JSON.stringify(correction.before_record) : null,
              correction.after_record ? JSON.stringify(correction.after_record) : null,
            ],
          )
        }
        await client.query("COMMIT")
        return repairResult(inserted.rows[0], "recorded")
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      } finally {
        client.release()
      }
    },

    async verifyRepair(input) {
      const request = validateVerificationRequest(input)
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        await client.query(
          "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
          [`reconciliation-verification:${request.repair_id}`],
        )
        const existing = await client.query(
          "SELECT * FROM reconciliation_repair_verifications WHERE repair_id = $1",
          [request.repair_id],
        )
        if (existing.rows[0]) {
          const row = existing.rows[0]
          if (row.verification_comparison_id !== request.comparison_id
            || iso(row.verified_at) !== request.verified_at) {
            throw new Error("repair verification already exists with different immutable input")
          }
          await client.query("COMMIT")
          return verificationResult(row, "duplicate")
        }
        const evidence = await client.query(
          `SELECT repair.*, original.comparison_revision AS original_revision,
                  verification.comparison_revision AS verification_revision,
                  verification.source_id AS verification_source_id,
                  verification.snapshot_id AS verification_snapshot_id,
                  verification.analytics_as_of AS verification_analytics_as_of,
                  verification.window_state AS verification_window_state,
                  verification.comparison_document AS verification_document
             FROM reconciliation_repairs repair
             JOIN reconciliation_comparisons original
               ON original.comparison_id = repair.comparison_id
             JOIN reconciliation_comparisons verification
               ON verification.comparison_id = $2
            WHERE repair.repair_id = $1
            FOR UPDATE OF repair`,
          [request.repair_id, request.comparison_id],
        )
        if (!evidence.rows[0]) throw new Error("repair or verification comparison was not found")
        const row = evidence.rows[0]
        if (row.verification_source_id !== row.source_id || row.verification_snapshot_id !== row.snapshot_id) {
          throw new Error("verification comparison must use the repaired snapshot scope")
        }
        if (Number(row.verification_revision) <= Number(row.original_revision)
          || Date.parse(row.verification_analytics_as_of) < Date.parse(row.repaired_at)
          || Date.parse(request.verified_at) < Date.parse(row.verification_analytics_as_of)) {
          throw new Error("verification comparison must be observed after the repair")
        }
        const correctionRows = await client.query(
          "SELECT entity_id FROM reconciliation_corrections WHERE repair_id = $1 ORDER BY entity_id",
          [request.repair_id],
        )
        const remaining = new Set(row.verification_document.discrepancies.map((item) => item.entity_id))
        const attempted = correctionRows.rowCount
        const successful = correctionRows.rows.filter((item) => !remaining.has(item.entity_id)).length
        const denominatorEmpty = attempted === 0
        const verificationDocument = {
          repair_id: request.repair_id,
          comparison_id: request.comparison_id,
          verified_at: request.verified_at,
          attempted_correction_count: attempted,
          successful_correction_count: successful,
          denominator_empty: denominatorEmpty,
          repair_success_rate: denominatorEmpty ? null : successful / attempted,
          current_projection_converged: row.verification_window_state === "RECONCILED",
        }
        const verificationHash = createHash("sha256").update(JSON.stringify(verificationDocument)).digest("hex")
        const inserted = await client.query(
          `INSERT INTO reconciliation_repair_verifications (
             repair_id, verification_comparison_id, verified_at, attempted_correction_count,
             successful_correction_count, denominator_empty, repair_success_rate,
             current_projection_converged, verification_hash, verification_document
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
           RETURNING *`,
          [
            request.repair_id, request.comparison_id, request.verified_at, attempted, successful,
            denominatorEmpty, verificationDocument.repair_success_rate,
            verificationDocument.current_projection_converged, verificationHash,
            JSON.stringify(verificationDocument),
          ],
        )
        await client.query("COMMIT")
        return verificationResult(inserted.rows[0], "recorded")
      } catch (error) {
        await client.query("ROLLBACK")
        throw error
      } finally {
        client.release()
      }
    },
  })
}
