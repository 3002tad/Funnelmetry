import { createHash } from "node:crypto"
import { calculateFunnelTimeBounds, classifyFunnelMaturity } from "@funnelmetry/time-semantics-contract"

function requiredString(value, field) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`)
  return value.trim()
}

function timestamp(value, field) {
  const normalized = requiredString(value, field)
  if (Number.isNaN(Date.parse(normalized))) throw new Error(`${field} must be an ISO-8601 timestamp`)
  return new Date(normalized).toISOString()
}

function iso(value) {
  return value === null || value === undefined ? null : new Date(value).toISOString()
}

export function validateEvaluationRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new Error("maturity evaluation request must be an object")
  }
  return Object.freeze({
    evaluation_id: requiredString(input.evaluation_id, "evaluation_id"),
    funnel_instance_id: requiredString(input.funnel_instance_id, "funnel_instance_id"),
    source_id: requiredString(input.source_id, "source_id"),
    evaluated_at: timestamp(input.evaluated_at, "evaluated_at"),
  })
}

function maturityReason(state) {
  return {
    UNCONFIGURED: "TIME_POLICY_UNCONFIGURED",
    PENDING: "AWAITING_FINALIZATION",
    SUSPECTED_DROPOFF: "TRANSITION_TIMEOUT_ELAPSED",
    MATURED: "HORIZON_GRACE_ELAPSED",
  }[state]
}

function eligibility(instance, configured) {
  if (instance.outcome_status !== "IN_PROGRESS") {
    return { status: "INELIGIBLE", reason: "OUTCOME_NOT_ELIGIBLE" }
  }
  if (!instance.authoritative_entry_time) {
    return { status: "INELIGIBLE", reason: "NON_AUTHORITATIVE_ENTRY_TIME" }
  }
  if (!configured) return { status: "UNDETERMINED", reason: "TIME_POLICY_UNCONFIGURED" }
  return { status: "ELIGIBLE", reason: null }
}

function semanticHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex")
}

function resultFromRow(row, status) {
  return Object.freeze({
    status,
    evaluation_id: row.evaluation_id,
    funnel_instance_id: row.funnel_instance_id,
    source_id: row.source_id,
    evaluation_revision: Number(row.evaluation_revision),
    maturity_state: row.maturity_state,
    maturity_reason: row.maturity_reason,
    eligibility_status: row.eligibility_status,
    eligibility_reason: row.eligibility_reason,
    evaluated_at: iso(row.evaluated_at),
    conversion_deadline: iso(row.conversion_deadline),
    finalization_at: iso(row.finalization_at),
    next_step_id: row.next_step_id,
    suspected_dropoff_at: iso(row.suspected_dropoff_at),
  })
}

function duplicateResult(row, request) {
  if (row.funnel_instance_id !== request.funnel_instance_id
    || row.source_id !== request.source_id
    || iso(row.evaluated_at) !== request.evaluated_at) {
    throw new Error("evaluation_id already exists with different immutable input")
  }
  return resultFromRow(row, "duplicate")
}

export function createFunnelMaturityRepository({ pool } = {}) {
  if (!pool || typeof pool.connect !== "function") throw new Error("A PostgreSQL pool is required")

  return Object.freeze({
    async listDueCandidates({ observed_at: observedAtInput, limit = 100 } = {}) {
      const observedAt = timestamp(observedAtInput, "observed_at")
      if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("limit must be a positive integer")
      const result = await pool.query(
        `WITH candidates AS (
           SELECT i.funnel_instance_id, i.source_id,
                  CASE
                    WHEN p.conversion_horizon_seconds IS NOT NULL
                     AND $1::timestamptz > i.conversion_deadline
                       + make_interval(secs => p.late_arrival_grace_seconds::double precision)
                      THEN 'MATURED'
                    WHEN timeout.timeout_seconds IS NOT NULL
                     AND $1::timestamptz >= reached.last_reached_at
                       + make_interval(secs => timeout.timeout_seconds::double precision)
                      THEN 'SUSPECTED_DROPOFF'
                  END AS target_state,
                  next_step.step_id AS next_step_id,
                  reached.last_reached_at
                    + make_interval(secs => timeout.timeout_seconds::double precision)
                    AS suspected_dropoff_at,
                  i.conversion_deadline
                    + make_interval(secs => p.late_arrival_grace_seconds::double precision)
                    AS finalization_at
             FROM funnel_instances i
             JOIN funnel_profiles p
               ON p.funnel_profile_id = i.funnel_profile_id
              AND p.profile_version = i.profile_version
             LEFT JOIN LATERAL (
               SELECT step_index, last_reached_at
                 FROM funnel_instance_steps
                WHERE funnel_instance_id = i.funnel_instance_id
                ORDER BY step_index DESC LIMIT 1
             ) reached ON true
             LEFT JOIN funnel_profile_steps next_step
               ON next_step.funnel_profile_id = i.funnel_profile_id
              AND next_step.profile_version = i.profile_version
              AND next_step.step_index = COALESCE(reached.step_index, -1) + 1
             LEFT JOIN funnel_profile_transition_timeouts timeout
               ON timeout.funnel_profile_id = i.funnel_profile_id
              AND timeout.profile_version = i.profile_version
              AND timeout.next_step_id = next_step.step_id
            WHERE i.outcome_status = 'IN_PROGRESS'
         ), due AS (
           SELECT candidates.*,
                  CASE WHEN target_state = 'MATURED' THEN finalization_at
                       ELSE suspected_dropoff_at END AS due_at
             FROM candidates
            WHERE target_state IS NOT NULL
         )
         SELECT due.funnel_instance_id, due.source_id, due.target_state,
                due.next_step_id, due.due_at
           FROM due
           LEFT JOIN funnel_instance_latest_maturity latest
             ON latest.funnel_instance_id = due.funnel_instance_id
          WHERE latest.maturity_state IS DISTINCT FROM due.target_state
             OR (due.target_state = 'SUSPECTED_DROPOFF'
                 AND (latest.next_step_id IS DISTINCT FROM due.next_step_id
                   OR latest.suspected_dropoff_at IS DISTINCT FROM due.suspected_dropoff_at))
          ORDER BY due.due_at, due.funnel_instance_id
          LIMIT $2`,
        [observedAt, limit],
      )
      return result.rows.map((row) => Object.freeze({
        funnel_instance_id: row.funnel_instance_id,
        source_id: row.source_id,
        target_state: row.target_state,
        next_step_id: row.next_step_id,
        due_at: iso(row.due_at),
      }))
    },

    async recordEvaluation(input) {
      const request = validateEvaluationRequest(input)
      const client = await pool.connect()
      try {
        await client.query("BEGIN")
        const existing = await client.query(
          `SELECT * FROM funnel_maturity_evaluations WHERE evaluation_id = $1`,
          [request.evaluation_id],
        )
        if (existing.rowCount === 1) {
          const duplicate = duplicateResult(existing.rows[0], request)
          await client.query("COMMIT")
          return duplicate
        }

        const instanceResult = await client.query(
          `SELECT i.*, p.conversion_horizon_seconds, p.late_arrival_grace_seconds,
                  COALESCE((entry.quality->>'authoritative_event_time')::boolean, false)
                    AS authoritative_entry_time
             FROM funnel_instances i
             JOIN funnel_profiles p
               ON p.funnel_profile_id = i.funnel_profile_id AND p.profile_version = i.profile_version
             JOIN canonical_events entry ON entry.canonical_event_id = i.entry_event_id
            WHERE i.funnel_instance_id = $1 AND i.source_id = $2
            FOR UPDATE OF i`,
          [request.funnel_instance_id, request.source_id],
        )
        if (instanceResult.rowCount !== 1) throw new Error("funnel instance is missing or outside source scope")
        const instance = instanceResult.rows[0]
        const concurrentExisting = await client.query(
          `SELECT * FROM funnel_maturity_evaluations WHERE evaluation_id = $1`,
          [request.evaluation_id],
        )
        if (concurrentExisting.rowCount === 1) {
          const duplicate = duplicateResult(concurrentExisting.rows[0], request)
          await client.query("COMMIT")
          return duplicate
        }
        const transitionResult = await client.query(
          `SELECT reached.last_reached_at, next_step.step_id AS next_step_id,
                  timeout.timeout_seconds
             FROM funnel_instances i
             LEFT JOIN LATERAL (
               SELECT step_index, last_reached_at
                 FROM funnel_instance_steps
                WHERE funnel_instance_id = i.funnel_instance_id
                ORDER BY step_index DESC LIMIT 1
             ) reached ON true
             LEFT JOIN funnel_profile_steps next_step
               ON next_step.funnel_profile_id = i.funnel_profile_id
              AND next_step.profile_version = i.profile_version
              AND next_step.step_index = COALESCE(reached.step_index, -1) + 1
             LEFT JOIN funnel_profile_transition_timeouts timeout
               ON timeout.funnel_profile_id = i.funnel_profile_id
              AND timeout.profile_version = i.profile_version
              AND timeout.next_step_id = next_step.step_id
            WHERE i.funnel_instance_id = $1`,
          [request.funnel_instance_id],
        )
        const transition = transitionResult.rows[0] ?? {}
        const transitionTimeouts = transition.next_step_id && transition.timeout_seconds !== null
          ? { [transition.next_step_id]: Number(transition.timeout_seconds) }
          : {}
        const policy = {
          conversion_horizon_seconds: instance.conversion_horizon_seconds === null
            ? null : Number(instance.conversion_horizon_seconds),
          late_arrival_grace_seconds: instance.late_arrival_grace_seconds === null
            ? null : Number(instance.late_arrival_grace_seconds),
          transition_timeouts_seconds: transitionTimeouts,
        }
        const bounds = calculateFunnelTimeBounds({ entry_at: iso(instance.entry_at), policy })
        if (iso(instance.conversion_deadline) !== bounds.conversion_deadline) {
          throw new Error("funnel instance deadline conflicts with immutable profile time policy")
        }
        const maturity = classifyFunnelMaturity({
          entry_at: iso(instance.entry_at),
          observed_at: request.evaluated_at,
          last_reached_at: iso(transition.last_reached_at) ?? undefined,
          next_step_id: transition.next_step_id ?? undefined,
          policy,
        })
        const eligibilityResult = eligibility(instance, bounds.configured)
        const latest = await client.query(
          `SELECT evaluation_revision, evaluated_at
             FROM funnel_maturity_evaluations
            WHERE funnel_instance_id = $1
            ORDER BY evaluation_revision DESC LIMIT 1`,
          [request.funnel_instance_id],
        )
        if (latest.rowCount === 1 && Date.parse(request.evaluated_at) < Date.parse(latest.rows[0].evaluated_at)) {
          throw new Error("maturity evaluation is older than the latest persisted evaluation")
        }
        const revision = latest.rowCount === 0 ? 1 : Number(latest.rows[0].evaluation_revision) + 1
        const evidence = {
          funnel_instance_id: request.funnel_instance_id,
          source_id: request.source_id,
          maturity_state: maturity.state,
          maturity_reason: maturityReason(maturity.state),
          eligibility_status: eligibilityResult.status,
          eligibility_reason: eligibilityResult.reason,
          outcome_status_snapshot: instance.outcome_status,
          quality_status_snapshot: instance.quality_status,
          authoritative_entry_time: instance.authoritative_entry_time,
          evaluated_at: request.evaluated_at,
          conversion_deadline: bounds.conversion_deadline,
          finalization_at: bounds.finalization_at,
          next_step_id: transition.next_step_id ?? null,
          suspected_dropoff_at: maturity.suspected_dropoff_at ?? null,
        }
        const hash = semanticHash(evidence)
        const sameEvidence = await client.query(
          `SELECT evaluation_id FROM funnel_maturity_evaluations
            WHERE funnel_instance_id = $1 AND evidence_hash = $2`,
          [request.funnel_instance_id, hash],
        )
        if (sameEvidence.rowCount === 1) throw new Error("identical maturity evidence used a different evaluation_id")
        const document = { evaluation_id: request.evaluation_id, evaluation_revision: revision, ...evidence }
        const inserted = await client.query(
          `INSERT INTO funnel_maturity_evaluations (
             evaluation_id, funnel_instance_id, source_id, evaluation_revision,
             maturity_state, maturity_reason, eligibility_status, eligibility_reason,
             outcome_status_snapshot, quality_status_snapshot, authoritative_entry_time,
             evaluated_at, conversion_deadline, finalization_at, next_step_id,
             suspected_dropoff_at, evidence_hash, evaluation_document
           ) VALUES (
             $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb
           ) RETURNING *`,
          [request.evaluation_id, request.funnel_instance_id, request.source_id, revision,
            evidence.maturity_state, evidence.maturity_reason, evidence.eligibility_status,
            evidence.eligibility_reason, evidence.outcome_status_snapshot,
            evidence.quality_status_snapshot, evidence.authoritative_entry_time,
            evidence.evaluated_at, evidence.conversion_deadline, evidence.finalization_at,
            evidence.next_step_id, evidence.suspected_dropoff_at, hash, JSON.stringify(document)],
        )
        await client.query("COMMIT")
        return resultFromRow(inserted.rows[0], "recorded")
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {})
        throw error
      } finally {
        client.release()
      }
    },
  })
}
