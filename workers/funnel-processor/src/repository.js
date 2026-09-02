import { createHash } from "node:crypto"
import { validateCanonicalEvent } from "@funnelmetry/canonical-contract"
import { classifyCanonicalEventArrival } from "@funnelmetry/time-semantics-contract"
import { evaluateFunnelWindow, validateProfile } from "./evaluator.js"

const STRONG_BUSINESS_ENTITY_TYPES = new Set(["CART", "CHECKOUT", "ORDER", "PAYMENT"])
const LATE_CONVERSION_ARRIVAL_CLASSES = new Set(["TOO_LATE_FOR_FINAL_COHORT", "AFTER_HORIZON"])

function deterministicInstanceId(profile, journeyId, entryEventId) {
  const digest = createHash("sha256")
    .update(JSON.stringify([profile.funnel_profile_id, profile.profile_version, journeyId, entryEventId]))
    .digest("hex")
  return `funnel_${digest}`
}

function deterministicLateConversionId(instanceId, conversionEventId) {
  const digest = createHash("sha256")
    .update(JSON.stringify([instanceId, conversionEventId]))
    .digest("hex")
  return `late_conversion_${digest}`
}

function toIso(value) {
  return new Date(value).toISOString()
}

function comparePosition(leftTime, leftId, rightTime, rightId) {
  return Date.parse(leftTime) - Date.parse(rightTime) || leftId.localeCompare(rightId)
}

function profileFromRows(profileRow, stepRows, negativeRows, transitionRows) {
  return validateProfile({
    funnel_profile_id: profileRow.funnel_profile_id,
    profile_version: profileRow.profile_version,
    display_name: profileRow.display_name,
    subject_scope: profileRow.subject_scope,
    entry_event_type: profileRow.entry_event_type,
    conversion_horizon_seconds: profileRow.conversion_horizon_seconds === null ? null : Number(profileRow.conversion_horizon_seconds),
    late_arrival_grace_seconds: profileRow.late_arrival_grace_seconds === null ? null : Number(profileRow.late_arrival_grace_seconds),
    ordered_steps: stepRows.map((row) => ({
      step_id: row.step_id,
      event_type: row.event_type,
      event_class: row.event_class,
    })),
    negative_events: negativeRows.map((row) => row.event_type),
    transition_timeouts_seconds: Object.fromEntries(
      transitionRows.map((row) => [row.next_step_id, Number(row.timeout_seconds)]),
    ),
  })
}

export function lateConversionCandidate({ instance, profile, projection, events }) {
  if (instance.outcome_status !== "DROPPED" || projection.outcome_status !== "CONVERTED") return null
  const finalStep = projection.steps.at(-1)
  const conversionEvent = events.find(
    (candidate) => candidate.canonical_event_id === finalStep?.representative_event_id,
  )
  if (!conversionEvent || conversionEvent.event_class !== "BUSINESS_FACT") return null
  if (conversionEvent.quality?.authoritative_event_time !== true) return null
  if (conversionEvent.link_confidence !== "STRONG"
    || !STRONG_BUSINESS_ENTITY_TYPES.has(conversionEvent.matched_entity_type)) return null
  const arrival = classifyCanonicalEventArrival({
    entry_at: toIso(instance.entry_at),
    occurred_at: conversionEvent.occurred_at,
    ingested_at: conversionEvent.ingested_at,
    time_basis: conversionEvent.quality.time_basis,
    policy: profile,
  })
  if (!LATE_CONVERSION_ARRIVAL_CLASSES.has(arrival.classification)) return null
  return Object.freeze({ conversionEvent, arrival })
}

async function recordLateConversion({ client, instance, profile, candidate, detectedAt }) {
  const finalization = await client.query(
    `SELECT f.finalization_id, f.kpi_projection_revision, f.kpi_projection_hash,
            k.outcome_status AS kpi_outcome_status,
            k.projection_revision AS current_kpi_projection_revision,
            k.projection_hash AS current_kpi_projection_hash,
            k.latest_projection_kind, k.latest_projection_id
       FROM funnel_maturity_finalizations f
       JOIN funnel_kpi_instance_facts k USING (funnel_instance_id)
      WHERE f.funnel_instance_id = $1`,
    [instance.funnel_instance_id],
  )
  if (finalization.rowCount !== 1) return null
  const official = finalization.rows[0]
  if (official.kpi_outcome_status !== "DROPPED"
    || official.latest_projection_kind !== "MATURITY_FINALIZATION"
    || official.latest_projection_id !== official.finalization_id
    || Number(official.current_kpi_projection_revision) !== Number(official.kpi_projection_revision)
    || official.current_kpi_projection_hash !== official.kpi_projection_hash) return null

  const { conversionEvent, arrival } = candidate
  const lateConversionId = deterministicLateConversionId(
    instance.funnel_instance_id,
    conversionEvent.canonical_event_id,
  )
  const document = {
    late_conversion_id: lateConversionId,
    finalization_id: official.finalization_id,
    funnel_instance_id: instance.funnel_instance_id,
    source_id: instance.source_id,
    journey_id: instance.journey_id,
    funnel_profile_id: profile.funnel_profile_id,
    profile_version: profile.profile_version,
    conversion_event_id: conversionEvent.canonical_event_id,
    arrival_class: arrival.classification,
    conversion_occurred_at: conversionEvent.occurred_at,
    conversion_ingested_at: conversionEvent.ingested_at,
    link_method: conversionEvent.link_method,
    link_confidence: conversionEvent.link_confidence,
    matched_entity_type: conversionEvent.matched_entity_type,
    official_outcome_status: "DROPPED",
    official_kpi_projection_revision: Number(official.kpi_projection_revision),
    official_kpi_projection_hash: official.kpi_projection_hash,
    detected_at: detectedAt,
  }
  const inserted = await client.query(
    `INSERT INTO funnel_late_conversions (
       late_conversion_id, finalization_id, funnel_instance_id, source_id, journey_id,
       conversion_event_id, arrival_class, conversion_occurred_at, conversion_ingested_at,
       link_method, link_confidence, matched_entity_type, official_outcome_status,
       official_kpi_projection_revision, official_kpi_projection_hash, detected_at,
       late_conversion_document
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'STRONG',$11,'DROPPED',$12,$13,$14,$15::jsonb)
     ON CONFLICT (funnel_instance_id) DO NOTHING
     RETURNING late_conversion_id`,
    [lateConversionId, official.finalization_id, instance.funnel_instance_id, instance.source_id,
      instance.journey_id, conversionEvent.canonical_event_id, arrival.classification,
      conversionEvent.occurred_at, conversionEvent.ingested_at, conversionEvent.link_method,
      conversionEvent.matched_entity_type, official.kpi_projection_revision,
      official.kpi_projection_hash, detectedAt, JSON.stringify(document)],
  )
  if (inserted.rowCount === 0) return null
  return Object.freeze(document)
}

export function createFunnelProfileRepository({ pool } = {}) {
  if (!pool || typeof pool.connect !== "function") throw new Error("A PostgreSQL pool is required")
  return Object.freeze({
    async publish({ sourceId, profile: input, publishedAt = new Date().toISOString() }) {
      if (typeof sourceId !== "string" || !sourceId) throw new Error("sourceId is required")
      const profile = validateProfile(input)
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        const insertedProfile = await client.query(
          `INSERT INTO funnel_profiles (
             funnel_profile_id, profile_version, display_name, subject_scope, entry_event_type,
             profile_document, conversion_horizon_seconds, late_arrival_grace_seconds, published_at
           ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)
           ON CONFLICT DO NOTHING RETURNING funnel_profile_id`,
          [profile.funnel_profile_id, profile.profile_version, profile.display_name, profile.subject_scope,
            profile.entry_event_type, JSON.stringify(profile), profile.conversion_horizon_seconds ?? null,
            profile.late_arrival_grace_seconds ?? null, publishedAt],
        )
        if (insertedProfile.rowCount === 0) {
          const existing = await client.query(
            `SELECT profile_document = $3::jsonb AS identical FROM funnel_profiles
              WHERE funnel_profile_id = $1 AND profile_version = $2`,
            [profile.funnel_profile_id, profile.profile_version, JSON.stringify(profile)],
          )
          if (existing.rowCount !== 1 || existing.rows[0].identical !== true) {
            throw new Error("funnel profile version already exists with different semantics")
          }
        } else {
          for (const [index, step] of profile.ordered_steps.entries()) {
            await client.query(
              `INSERT INTO funnel_profile_steps (
                 funnel_profile_id, profile_version, step_index, step_id, event_type, event_class
               ) VALUES ($1, $2, $3, $4, $5, $6)`,
              [profile.funnel_profile_id, profile.profile_version, index, step.step_id, step.event_type, step.event_class],
            )
          }
          for (const eventType of profile.negative_events) {
            await client.query(
              `INSERT INTO funnel_profile_negative_events (funnel_profile_id, profile_version, event_type)
               VALUES ($1, $2, $3)`,
              [profile.funnel_profile_id, profile.profile_version, eventType],
            )
          }
          for (const [nextStepId, timeoutSeconds] of Object.entries(profile.transition_timeouts_seconds ?? {})) {
            await client.query(
              `INSERT INTO funnel_profile_transition_timeouts (
                 funnel_profile_id, profile_version, next_step_id, timeout_seconds
               ) VALUES ($1, $2, $3, $4)`,
              [profile.funnel_profile_id, profile.profile_version, nextStepId, timeoutSeconds],
            )
          }
        }
        await client.query(
          `INSERT INTO funnel_profile_activations (source_id, funnel_profile_id, profile_version, enabled_at)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (source_id, funnel_profile_id, profile_version)
           DO UPDATE SET disabled_at = NULL`,
          [sourceId, profile.funnel_profile_id, profile.profile_version, publishedAt],
        )
        await client.query("COMMIT")
        return profile
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {})
        throw error
      } finally {
        client.release()
      }
    },
  })
}

export function createFunnelRepository({ pool, now = () => new Date().toISOString() } = {}) {
  if (!pool || typeof pool.connect !== "function") throw new Error("A PostgreSQL pool is required")

  return Object.freeze({
    async project({ journeyId, canonicalEvent: input }) {
      if (typeof journeyId !== "string" || !journeyId) throw new Error("journeyId is required")
      const event = validateCanonicalEvent(input)
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        const profilesResult = await client.query(
          `SELECT DISTINCT p.*
             FROM funnel_profiles p
             JOIN funnel_profile_activations a
               ON a.funnel_profile_id = p.funnel_profile_id AND a.profile_version = p.profile_version
             LEFT JOIN funnel_profile_steps s
               ON s.funnel_profile_id = p.funnel_profile_id AND s.profile_version = p.profile_version
             LEFT JOIN funnel_profile_negative_events n
               ON n.funnel_profile_id = p.funnel_profile_id AND n.profile_version = p.profile_version
            WHERE a.source_id = $1 AND a.disabled_at IS NULL
              AND (s.event_type = $2 OR n.event_type = $2)
            ORDER BY p.funnel_profile_id, p.profile_version`,
          [event.source_id, event.event_type],
        )
        const updates = []
        const lateConversions = []
        let duplicateProfiles = 0

        for (const profileRow of profilesResult.rows) {
          const applied = await client.query(
            `SELECT application_status FROM funnel_event_applications
              WHERE canonical_event_id = $1 AND funnel_profile_id = $2 AND profile_version = $3`,
            [event.canonical_event_id, profileRow.funnel_profile_id, profileRow.profile_version],
          )
          if (applied.rowCount === 1) {
            duplicateProfiles += 1
            continue
          }
          const profileIdentity = [profileRow.funnel_profile_id, profileRow.profile_version]
          const stepsResult = await client.query(
            `SELECT step_id, event_type, event_class FROM funnel_profile_steps
              WHERE funnel_profile_id = $1 AND profile_version = $2 ORDER BY step_index`,
            profileIdentity,
          )
          const negativesResult = await client.query(
            `SELECT event_type FROM funnel_profile_negative_events
              WHERE funnel_profile_id = $1 AND profile_version = $2 ORDER BY event_type`,
            profileIdentity,
          )
          const transitionsResult = await client.query(
            `SELECT next_step_id, timeout_seconds FROM funnel_profile_transition_timeouts
              WHERE funnel_profile_id = $1 AND profile_version = $2 ORDER BY next_step_id`,
            profileIdentity,
          )
          const profile = profileFromRows(
            profileRow,
            stepsResult.rows,
            negativesResult.rows,
            transitionsResult.rows,
          )

          if (event.event_type === profile.entry_event_type && event.event_class === profile.ordered_steps[0].event_class) {
            const deadline = profile.conversion_horizon_seconds === null
              ? null
              : new Date(Date.parse(event.occurred_at) + profile.conversion_horizon_seconds * 1000).toISOString()
            await client.query(
              `INSERT INTO funnel_instances (
                 funnel_instance_id, source_id, journey_id, funnel_profile_id, profile_version,
                 entry_event_id, entry_at, conversion_deadline
               ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
               ON CONFLICT (funnel_profile_id, profile_version, journey_id, entry_event_id) DO NOTHING`,
              [deterministicInstanceId(profile, journeyId, event.canonical_event_id), event.source_id, journeyId,
                profile.funnel_profile_id, profile.profile_version, event.canonical_event_id, event.occurred_at, deadline],
            )
          }

          const instancesResult = await client.query(
            `SELECT * FROM funnel_instances
              WHERE journey_id = $1 AND funnel_profile_id = $2 AND profile_version = $3
              ORDER BY entry_at, entry_event_id FOR UPDATE`,
            [journeyId, profile.funnel_profile_id, profile.profile_version],
          )
          const journeyEventsResult = await client.query(
            `SELECT c.canonical_event_id, c.event_type, c.event_class, c.occurred_at,
                    c.ingested_at, c.quality, j.link_method, j.link_confidence,
                    j.matched_entity_type
               FROM journey_events j JOIN canonical_events c USING (canonical_event_id)
              WHERE j.journey_id = $1 ORDER BY c.occurred_at, c.canonical_event_id`,
            [journeyId],
          )

          for (const [index, instance] of instancesResult.rows.entries()) {
            const next = instancesResult.rows[index + 1]
            const instanceEvents = journeyEventsResult.rows.filter((candidate) => {
              const afterEntry = comparePosition(candidate.occurred_at, candidate.canonical_event_id, instance.entry_at, instance.entry_event_id) >= 0
              const beforeNext = !next || comparePosition(candidate.occurred_at, candidate.canonical_event_id, next.entry_at, next.entry_event_id) < 0
              return afterEntry && beforeNext
            }).map((candidate) => ({
              ...candidate,
              occurred_at: toIso(candidate.occurred_at),
              ingested_at: toIso(candidate.ingested_at),
            }))

            if (instance.outcome_status === "DROPPED") {
              const fullProjection = evaluateFunnelWindow(profile, instanceEvents)
              const candidate = lateConversionCandidate({
                instance,
                profile,
                projection: fullProjection,
                events: instanceEvents,
              })
              if (candidate) {
                const recorded = await recordLateConversion({
                  client,
                  instance,
                  profile,
                  candidate,
                  detectedAt: now(),
                })
                if (recorded) lateConversions.push(recorded)
              }
              continue
            }

            const windowEvents = instanceEvents.filter((candidate) => (
              !instance.conversion_deadline
              || Date.parse(candidate.occurred_at) <= Date.parse(instance.conversion_deadline)
            ))
            const projection = evaluateFunnelWindow(profile, windowEvents)
            await client.query("DELETE FROM funnel_instance_steps WHERE funnel_instance_id = $1", [instance.funnel_instance_id])
            await client.query("DELETE FROM funnel_instance_branches WHERE funnel_instance_id = $1", [instance.funnel_instance_id])
            for (const step of projection.steps) {
              await client.query(
                `INSERT INTO funnel_instance_steps (
                   funnel_instance_id, step_index, step_id, event_type, representative_event_id,
                   first_reached_at, last_reached_at, occurrence_count, sequence_status
                 ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
                [instance.funnel_instance_id, step.step_index, step.step_id, step.event_type,
                  step.representative_event_id, step.first_reached_at, step.last_reached_at,
                  step.occurrence_count, step.sequence_status],
              )
            }
            for (const branch of projection.branches) {
              await client.query(
                `INSERT INTO funnel_instance_branches (
                   funnel_instance_id, canonical_event_id, event_type, occurred_at, branch_kind
                 ) VALUES ($1,$2,$3,$4,$5)`,
                [instance.funnel_instance_id, branch.canonical_event_id, branch.event_type, branch.occurred_at, branch.branch_kind],
              )
            }
            const updatedAt = now()
            await client.query(
              `UPDATE funnel_instances SET outcome_status = $2, converted_at = $3, updated_at = $4
                WHERE funnel_instance_id = $1`,
              [instance.funnel_instance_id, projection.outcome_status, projection.converted_at, updatedAt],
            )
            updates.push(Object.freeze({
              funnel_instance_id: instance.funnel_instance_id,
              funnel_profile_id: profile.funnel_profile_id,
              profile_version: profile.profile_version,
              outcome_status: projection.outcome_status,
              quality_status: instance.quality_status,
              converted_at: projection.converted_at,
              reached_step_count: projection.steps.length,
              branch_count: projection.branches.length,
              updated_at: updatedAt,
            }))
          }
          await client.query(
            `INSERT INTO funnel_event_applications (
               canonical_event_id, funnel_profile_id, profile_version, journey_id, application_status, applied_at
             ) VALUES ($1,$2,$3,$4,$5,$6)`,
            [event.canonical_event_id, profile.funnel_profile_id, profile.profile_version, journeyId,
              instancesResult.rowCount > 0 ? "APPLIED" : "NO_OPEN_INSTANCE", now()],
          )
        }
        await client.query("COMMIT")
        return Object.freeze({
          status: profilesResult.rowCount > 0 && duplicateProfiles === profilesResult.rowCount ? "duplicate" : "projected",
          canonical_event_id: event.canonical_event_id,
          journey_id: journeyId,
          updates: Object.freeze(updates),
          late_conversions: Object.freeze(lateConversions),
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
