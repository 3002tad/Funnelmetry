import { buildKpiSnapshot, hashKpiSnapshot } from "@funnelmetry/kpi-snapshot-contract"

function iso(value) {
  return value === null ? null : new Date(value).toISOString()
}

export function createKpiRepository({ pool, now = () => new Date().toISOString() } = {}) {
  if (!pool || typeof pool.connect !== "function") throw new Error("A PostgreSQL pool is required")
  return Object.freeze({
    async project({ triggerEventId, sourceId, journeyId, instanceIds }) {
      if (![triggerEventId, sourceId, journeyId].every((value) => typeof value === "string" && value)) {
        throw new Error("Complete KPI projection identity is required")
      }
      if (!Array.isArray(instanceIds)) throw new Error("instanceIds must be an array")
      const uniqueInstanceIds = [...new Set(instanceIds)]
      if (uniqueInstanceIds.length !== instanceIds.length) throw new Error("instanceIds must be unique")
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        const existing = await client.query(
          `SELECT journey_id, source_id, changed_instance_count, applied_at
             FROM kpi_projection_applications WHERE trigger_event_id = $1`,
          [triggerEventId],
        )
        if (existing.rowCount === 1) {
          if (existing.rows[0].source_id !== sourceId || existing.rows[0].journey_id !== journeyId) {
            throw new Error("KPI trigger event was already applied to a different scope")
          }
          await client.query("COMMIT")
          return Object.freeze({
            status: "duplicate", trigger_event_id: triggerEventId, source_id: sourceId, journey_id: journeyId,
            changed_instances: Object.freeze([]), applied_at: iso(existing.rows[0].applied_at),
          })
        }

        const changedInstances = []
        for (const instanceId of uniqueInstanceIds) {
          const instanceResult = await client.query(
            `SELECT i.*,
                    (SELECT COUNT(*)::INTEGER FROM funnel_profile_steps profile_steps
                      WHERE profile_steps.funnel_profile_id = i.funnel_profile_id
                        AND profile_steps.profile_version = i.profile_version) AS total_step_count
               FROM funnel_instances i
              WHERE i.funnel_instance_id = $1 AND i.source_id = $2 AND i.journey_id = $3
              FOR UPDATE`,
            [instanceId, sourceId, journeyId],
          )
          if (instanceResult.rowCount !== 1) throw new Error(`funnel instance ${instanceId} is missing or outside the envelope scope`)
          const stepsResult = await client.query(
            `SELECT step_index, step_id, event_type, first_reached_at, last_reached_at, occurrence_count
               FROM funnel_instance_steps WHERE funnel_instance_id = $1 ORDER BY step_index`,
            [instanceId],
          )
          const branchesResult = await client.query(
            `SELECT canonical_event_id, event_type, occurred_at, branch_kind
               FROM funnel_instance_branches WHERE funnel_instance_id = $1 ORDER BY occurred_at, canonical_event_id`,
            [instanceId],
          )
          const snapshot = buildKpiSnapshot(instanceResult.rows[0], stepsResult.rows, branchesResult.rows)
          const hash = hashKpiSnapshot(snapshot)
          const projectedAt = now()
          const upsert = await client.query(
            `INSERT INTO funnel_kpi_instance_facts (
               funnel_instance_id, source_id, journey_id, funnel_profile_id, profile_version,
               entry_at, conversion_deadline, outcome_status, quality_status, converted_at,
               reached_step_count, total_step_count, branch_count, latest_trigger_event_id,
               latest_projection_kind, latest_projection_id, projection_hash, projected_at
             ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'CANONICAL_EVENT',$14,$15,$16)
             ON CONFLICT (funnel_instance_id) DO UPDATE SET
               outcome_status = EXCLUDED.outcome_status,
               quality_status = EXCLUDED.quality_status,
               converted_at = EXCLUDED.converted_at,
               reached_step_count = EXCLUDED.reached_step_count,
               total_step_count = EXCLUDED.total_step_count,
               branch_count = EXCLUDED.branch_count,
               latest_trigger_event_id = EXCLUDED.latest_trigger_event_id,
               latest_projection_kind = EXCLUDED.latest_projection_kind,
               latest_projection_id = EXCLUDED.latest_projection_id,
               projection_hash = EXCLUDED.projection_hash,
               projection_revision = funnel_kpi_instance_facts.projection_revision + 1,
               projected_at = EXCLUDED.projected_at
             WHERE funnel_kpi_instance_facts.projection_hash IS DISTINCT FROM EXCLUDED.projection_hash
             RETURNING projection_revision`,
            [snapshot.funnel_instance_id, snapshot.source_id, snapshot.journey_id,
              snapshot.funnel_profile_id, snapshot.profile_version, snapshot.entry_at,
              snapshot.conversion_deadline, snapshot.outcome_status, snapshot.quality_status,
              snapshot.converted_at, snapshot.reached_step_count, snapshot.total_step_count,
              snapshot.branch_count, triggerEventId, hash, projectedAt],
          )
          if (upsert.rowCount === 0) continue
          await client.query("DELETE FROM funnel_kpi_step_facts WHERE funnel_instance_id = $1", [instanceId])
          await client.query("DELETE FROM funnel_kpi_branch_facts WHERE funnel_instance_id = $1", [instanceId])
          for (const step of snapshot.steps) {
            await client.query(
              `INSERT INTO funnel_kpi_step_facts (
                 funnel_instance_id, step_index, step_id, event_type, first_reached_at, last_reached_at, occurrence_count
               ) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [instanceId, step.step_index, step.step_id, step.event_type,
                step.first_reached_at, step.last_reached_at, step.occurrence_count],
            )
          }
          for (const branch of snapshot.branches) {
            await client.query(
              `INSERT INTO funnel_kpi_branch_facts (
                 funnel_instance_id, canonical_event_id, event_type, occurred_at, branch_kind
               ) VALUES ($1,$2,$3,$4,$5)`,
              [instanceId, branch.canonical_event_id, branch.event_type, branch.occurred_at, branch.branch_kind],
            )
          }
          changedInstances.push(Object.freeze({
            funnel_instance_id: instanceId,
            funnel_profile_id: snapshot.funnel_profile_id,
            profile_version: snapshot.profile_version,
            outcome_status: snapshot.outcome_status,
            quality_status: snapshot.quality_status,
            projection_revision: Number(upsert.rows[0].projection_revision),
          }))
        }
        const appliedAt = now()
        await client.query(
          `INSERT INTO kpi_projection_applications (
             trigger_event_id, journey_id, source_id, changed_instance_count, applied_at
           ) VALUES ($1,$2,$3,$4,$5)`,
          [triggerEventId, journeyId, sourceId, changedInstances.length, appliedAt],
        )
        await client.query("COMMIT")
        return Object.freeze({
          status: "projected", trigger_event_id: triggerEventId, source_id: sourceId, journey_id: journeyId,
          changed_instances: Object.freeze(changedInstances), applied_at: appliedAt,
        })
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {})
        throw error
      } finally {
        client.release()
      }
    },
  })
}
