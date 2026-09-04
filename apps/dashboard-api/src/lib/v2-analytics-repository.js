function number(value) {
  return Number(value ?? 0)
}

function rate(numerator, denominator) {
  const total = number(denominator)
  return total === 0 ? null : number(numerator) / total
}

function reconciliationGate({ snapshots, provisional, reconciling, reconciled, degraded }) {
  let state = "UNAVAILABLE"
  const reasons = []
  if (snapshots > 0) {
    if (degraded > 0) {
      state = "DEGRADED"
      reasons.push("DEGRADED_WINDOW")
    } else if (provisional > 0) {
      state = "PROVISIONAL"
      reasons.push("PROVISIONAL_WINDOW")
    } else if (reconciling > 0) {
      state = "RECONCILING"
      reasons.push("UNRESOLVED_DISCREPANCY")
    } else if (reconciled === snapshots) {
      state = "RECONCILED"
    }
  } else {
    reasons.push("NO_RECONCILIATION_EVIDENCE")
  }
  return Object.freeze({
    state,
    eligible_for_authoritative_business_analysis: state === "RECONCILED",
    eligible_window_count: reconciled,
    ineligible_window_count: snapshots - reconciled,
    reasons: Object.freeze(reasons),
  })
}

function cohortFilter({ sourceId, from, to }, alias = "i", startIndex = 1) {
  const clauses = [`${alias}.source_id = $${startIndex}`]
  const params = [sourceId]
  if (from) {
    params.push(from)
    clauses.push(`${alias}.entry_at >= $${startIndex + params.length - 1}::timestamptz`)
  }
  if (to) {
    params.push(to)
    clauses.push(`${alias}.entry_at < $${startIndex + params.length - 1}::timestamptz`)
  }
  return { sql: clauses.join(" AND "), params }
}

function timestampFilter({ sourceId, from, to }, column, alias = "c") {
  const clauses = [`${alias}.source_id = $1`]
  const params = [sourceId]
  if (from) {
    params.push(from)
    clauses.push(`${alias}.${column} >= $${params.length}::timestamptz`)
  }
  if (to) {
    params.push(to)
    clauses.push(`${alias}.${column} < $${params.length}::timestamptz`)
  }
  return { sql: clauses.join(" AND "), params }
}

function mapProfileTotal(row) {
  const entrants = number(row.entrants)
  const converted = number(row.observed_converted)
  const finalizedDropped = number(row.finalized_dropped)
  const lateConversions = number(row.late_conversions)
  const maturedConverted = number(row.matured_converted)
  const eligibleMatured = maturedConverted + finalizedDropped
  return {
    funnel_profile_id: row.funnel_profile_id,
    profile_version: row.profile_version,
    display_name: row.display_name,
    entrants,
    observed_converted: converted,
    pending: number(row.pending),
    dropped: number(row.dropped),
    terminated: number(row.terminated),
    invalid: number(row.invalid),
    eligible_matured: eligibleMatured,
    matured_converted: maturedConverted,
    finalized_dropped: finalizedDropped,
    late_conversions: lateConversions,
    too_late_for_final_cohort: number(row.too_late_for_final_cohort),
    after_horizon: number(row.after_horizon),
    late_conversion_rate: rate(lateConversions, finalizedDropped),
    final_end_to_end_rate: rate(maturedConverted, eligibleMatured),
    final_dropoff_rate: rate(finalizedDropped, eligibleMatured),
    provisional: number(row.provisional),
    reconciling: number(row.reconciling),
    reconciled: number(row.reconciled),
    degraded: number(row.degraded),
    observed_end_to_end_rate: rate(converted, entrants),
    first_entry_at: row.first_entry_at,
    last_entry_at: row.last_entry_at,
  }
}

export function createV2AnalyticsRepository({ query } = {}) {
  if (typeof query !== "function") throw new Error("A read-only PostgreSQL query function is required")

  async function resolveProfile(sourceId, profileId, version) {
    const params = [sourceId, profileId]
    let versionClause = ""
    if (version) {
      params.push(version)
      versionClause = " AND p.profile_version = $3"
    }
    const rows = await query(
      `SELECT p.funnel_profile_id, p.profile_version, p.display_name, p.subject_scope,
              p.entry_event_type, p.conversion_horizon_seconds, p.late_arrival_grace_seconds,
              p.published_at
         FROM funnel_profiles p
         JOIN funnel_profile_activations a
           ON a.funnel_profile_id = p.funnel_profile_id AND a.profile_version = p.profile_version
        WHERE a.source_id = $1 AND a.disabled_at IS NULL AND p.funnel_profile_id = $2${versionClause}
        ORDER BY p.published_at DESC
        LIMIT 1`,
      params,
    )
    return rows[0] ?? null
  }

  return Object.freeze({
    async getOverview(scope) {
      const filter = cohortFilter(scope)
      const rows = await query(
        `SELECT i.funnel_profile_id, i.profile_version, p.display_name,
                COUNT(*)::bigint AS entrants,
                COUNT(*) FILTER (WHERE i.outcome_status = 'CONVERTED')::bigint AS observed_converted,
                COUNT(*) FILTER (WHERE i.outcome_status = 'IN_PROGRESS')::bigint AS pending,
                COUNT(*) FILTER (WHERE i.outcome_status = 'DROPPED')::bigint AS dropped,
                COUNT(*) FILTER (WHERE i.outcome_status = 'TERMINATED')::bigint AS terminated,
                COUNT(*) FILTER (WHERE i.outcome_status = 'INVALID')::bigint AS invalid,
                COUNT(*) FILTER (
                  WHERE latest_maturity.maturity_state = 'MATURED'
                    AND latest_maturity.eligibility_status = 'ELIGIBLE'
                    AND i.outcome_status = 'CONVERTED'
                )::bigint AS matured_converted,
                COUNT(finalization.finalization_id)::bigint AS finalized_dropped,
                COUNT(late_conversion.late_conversion_id)::bigint AS late_conversions,
                COUNT(late_conversion.late_conversion_id) FILTER (
                  WHERE late_conversion.arrival_class = 'TOO_LATE_FOR_FINAL_COHORT'
                )::bigint AS too_late_for_final_cohort,
                COUNT(late_conversion.late_conversion_id) FILTER (
                  WHERE late_conversion.arrival_class = 'AFTER_HORIZON'
                )::bigint AS after_horizon,
                COUNT(*) FILTER (WHERE i.quality_status = 'PROVISIONAL')::bigint AS provisional,
                COUNT(*) FILTER (WHERE i.quality_status = 'RECONCILING')::bigint AS reconciling,
                COUNT(*) FILTER (WHERE i.quality_status = 'RECONCILED')::bigint AS reconciled,
                COUNT(*) FILTER (WHERE i.quality_status = 'DEGRADED')::bigint AS degraded,
                MIN(i.entry_at) AS first_entry_at,
                MAX(i.entry_at) AS last_entry_at
           FROM funnel_kpi_instance_facts i
           JOIN funnel_profiles p
             ON p.funnel_profile_id = i.funnel_profile_id AND p.profile_version = i.profile_version
           LEFT JOIN funnel_maturity_finalizations finalization
             ON finalization.funnel_instance_id = i.funnel_instance_id
           LEFT JOIN funnel_late_conversions late_conversion
             ON late_conversion.funnel_instance_id = i.funnel_instance_id
           LEFT JOIN funnel_instance_latest_maturity latest_maturity
             ON latest_maturity.funnel_instance_id = i.funnel_instance_id
          WHERE ${filter.sql}
          GROUP BY i.funnel_profile_id, i.profile_version, p.display_name
          ORDER BY p.display_name, i.profile_version`,
        filter.params,
      )
      return Object.freeze({
        source_id: scope.sourceId,
        cohort: Object.freeze({ basis: "entry_at", from: scope.from, to: scope.to }),
        metric_state: "OBSERVED",
        profiles: Object.freeze(rows.map(mapProfileTotal)),
      })
    },

    async getFunnel(scope, identity) {
      const profile = await resolveProfile(scope.sourceId, identity.profileId, identity.version)
      if (!profile) return null
      const filter = cohortFilter(scope)
      const profileIndex = filter.params.length + 1
      const versionIndex = profileIndex + 1
      const params = [...filter.params, profile.funnel_profile_id, profile.profile_version]
      const totalsRows = await query(
        `SELECT COUNT(*)::bigint AS entrants,
                COUNT(*) FILTER (WHERE i.outcome_status = 'CONVERTED')::bigint AS observed_converted,
                COUNT(*) FILTER (WHERE i.outcome_status = 'IN_PROGRESS')::bigint AS pending,
                COUNT(*) FILTER (WHERE i.outcome_status = 'DROPPED')::bigint AS dropped,
                COUNT(*) FILTER (WHERE i.outcome_status = 'TERMINATED')::bigint AS terminated,
                COUNT(*) FILTER (WHERE i.outcome_status = 'INVALID')::bigint AS invalid,
                COUNT(*) FILTER (
                  WHERE latest_maturity.maturity_state = 'MATURED'
                    AND latest_maturity.eligibility_status = 'ELIGIBLE'
                    AND i.outcome_status = 'CONVERTED'
                )::bigint AS matured_converted,
                COUNT(finalization.finalization_id)::bigint AS finalized_dropped,
                COUNT(late_conversion.late_conversion_id)::bigint AS late_conversions,
                COUNT(late_conversion.late_conversion_id) FILTER (
                  WHERE late_conversion.arrival_class = 'TOO_LATE_FOR_FINAL_COHORT'
                )::bigint AS too_late_for_final_cohort,
                COUNT(late_conversion.late_conversion_id) FILTER (
                  WHERE late_conversion.arrival_class = 'AFTER_HORIZON'
                )::bigint AS after_horizon,
                COUNT(*) FILTER (WHERE i.quality_status = 'PROVISIONAL')::bigint AS provisional,
                COUNT(*) FILTER (WHERE i.quality_status = 'RECONCILING')::bigint AS reconciling,
                COUNT(*) FILTER (WHERE i.quality_status = 'RECONCILED')::bigint AS reconciled,
                COUNT(*) FILTER (WHERE i.quality_status = 'DEGRADED')::bigint AS degraded,
                MIN(i.entry_at) AS first_entry_at, MAX(i.entry_at) AS last_entry_at
           FROM funnel_kpi_instance_facts i
           LEFT JOIN funnel_maturity_finalizations finalization
             ON finalization.funnel_instance_id = i.funnel_instance_id
           LEFT JOIN funnel_late_conversions late_conversion
             ON late_conversion.funnel_instance_id = i.funnel_instance_id
           LEFT JOIN funnel_instance_latest_maturity latest_maturity
             ON latest_maturity.funnel_instance_id = i.funnel_instance_id
          WHERE ${filter.sql}
            AND i.funnel_profile_id = $${profileIndex}
            AND i.profile_version = $${versionIndex}`,
        params,
      )
      const stepRows = await query(
        `SELECT steps.step_index, steps.step_id, steps.event_type, steps.event_class,
                COUNT(instances.funnel_instance_id)::bigint AS entrants,
                COUNT(reached.funnel_instance_id)::bigint AS reached
           FROM funnel_profile_steps steps
           LEFT JOIN funnel_kpi_instance_facts instances
             ON instances.funnel_profile_id = steps.funnel_profile_id
            AND instances.profile_version = steps.profile_version
            AND ${filter.sql.replaceAll("i.", "instances.")}
           LEFT JOIN funnel_kpi_step_facts reached
             ON reached.funnel_instance_id = instances.funnel_instance_id
            AND reached.step_index = steps.step_index
          WHERE steps.funnel_profile_id = $${profileIndex}
            AND steps.profile_version = $${versionIndex}
          GROUP BY steps.step_index, steps.step_id, steps.event_type, steps.event_class
          ORDER BY steps.step_index`,
        params,
      )
      const totals = mapProfileTotal({
        ...totalsRows[0], funnel_profile_id: profile.funnel_profile_id,
        profile_version: profile.profile_version, display_name: profile.display_name,
      })
      return Object.freeze({
        source_id: scope.sourceId,
        cohort: Object.freeze({ basis: "entry_at", from: scope.from, to: scope.to }),
        metric_state: "OBSERVED",
        profile: Object.freeze({
          funnel_profile_id: profile.funnel_profile_id,
          profile_version: profile.profile_version,
          display_name: profile.display_name,
          subject_scope: profile.subject_scope,
          entry_event_type: profile.entry_event_type,
          conversion_horizon_seconds: profile.conversion_horizon_seconds === null ? null : number(profile.conversion_horizon_seconds),
          late_arrival_grace_seconds: profile.late_arrival_grace_seconds === null ? null : number(profile.late_arrival_grace_seconds),
          published_at: profile.published_at,
        }),
        totals: Object.freeze(totals),
        steps: Object.freeze(stepRows.map((row) => {
          const entrants = number(row.entrants)
          const reached = number(row.reached)
          return {
            step_index: row.step_index,
            step_id: row.step_id,
            event_type: row.event_type,
            event_class: row.event_class,
            entrants,
            reached,
            observed_reach_rate: rate(reached, entrants),
          }
        })),
      })
    },

    async listJourneys({ sourceId, limit }) {
      const rows = await query(
        `SELECT j.journey_id, j.status, j.first_event_at, j.last_event_at, j.event_count,
                COUNT(DISTINCT entities.entity_type)::integer AS entity_type_count,
                COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
                  'funnel_instance_id', instances.funnel_instance_id,
                  'funnel_profile_id', instances.funnel_profile_id,
                  'profile_version', instances.profile_version,
                  'outcome_status', instances.outcome_status,
                  'quality_status', instances.quality_status,
                  'entry_at', instances.entry_at,
                  'converted_at', instances.converted_at,
                  'has_late_conversion', late_conversion.late_conversion_id IS NOT NULL
                )) FILTER (WHERE instances.funnel_instance_id IS NOT NULL), '[]'::jsonb) AS funnel_instances
           FROM journeys j
           LEFT JOIN journey_entities entities ON entities.journey_id = j.journey_id
           LEFT JOIN funnel_instances instances ON instances.journey_id = j.journey_id
           LEFT JOIN funnel_late_conversions late_conversion
             ON late_conversion.funnel_instance_id = instances.funnel_instance_id
          WHERE j.source_id = $1
          GROUP BY j.journey_id
          ORDER BY j.last_event_at DESC, j.journey_id
          LIMIT $2`,
        [sourceId, limit],
      )
      return Object.freeze(rows.map((row) => ({
        ...row,
        event_count: number(row.event_count),
        entity_type_count: number(row.entity_type_count),
      })))
    },

    async getJourney(sourceId, journeyId) {
      const journeys = await query(
        `SELECT journey_id, source_id, status, first_event_at, last_event_at, event_count
           FROM journeys WHERE source_id = $1 AND journey_id = $2`,
        [sourceId, journeyId],
      )
      if (!journeys[0]) return null
      const [events, evidence, instances] = await Promise.all([
        query(
          `SELECT c.canonical_event_id, c.event_type, c.event_class, c.occurred_at,
                  c.quality, je.link_method, je.link_confidence
             FROM journey_events je JOIN canonical_events c USING (canonical_event_id)
            WHERE je.journey_id = $1 ORDER BY c.occurred_at, c.canonical_event_id`,
          [journeyId],
        ),
        query(
          `SELECT entity_type, link_method, link_confidence, COUNT(*)::integer AS evidence_count
             FROM journey_entities WHERE journey_id = $1
            GROUP BY entity_type, link_method, link_confidence
            ORDER BY link_confidence, entity_type`,
          [journeyId],
        ),
        query(
          `SELECT i.funnel_instance_id, i.funnel_profile_id, i.profile_version, i.entry_at,
                  i.conversion_deadline, i.outcome_status, i.quality_status, i.converted_at,
                  CASE WHEN late_conversion.late_conversion_id IS NULL THEN NULL ELSE jsonb_build_object(
                    'late_conversion_id', late_conversion.late_conversion_id,
                    'conversion_event_id', late_conversion.conversion_event_id,
                    'arrival_class', late_conversion.arrival_class,
                    'conversion_occurred_at', late_conversion.conversion_occurred_at,
                    'conversion_ingested_at', late_conversion.conversion_ingested_at,
                    'link_method', late_conversion.link_method,
                    'link_confidence', late_conversion.link_confidence,
                    'matched_entity_type', late_conversion.matched_entity_type,
                    'detected_at', late_conversion.detected_at
                  ) END AS late_conversion,
                  COALESCE(jsonb_agg(jsonb_build_object(
                    'step_index', s.step_index, 'step_id', s.step_id, 'event_type', s.event_type,
                    'first_reached_at', s.first_reached_at, 'last_reached_at', s.last_reached_at,
                    'occurrence_count', s.occurrence_count, 'sequence_status', s.sequence_status
                  ) ORDER BY s.step_index) FILTER (WHERE s.step_index IS NOT NULL), '[]'::jsonb) AS steps
             FROM funnel_instances i
             LEFT JOIN funnel_instance_steps s ON s.funnel_instance_id = i.funnel_instance_id
             LEFT JOIN funnel_late_conversions late_conversion
               ON late_conversion.funnel_instance_id = i.funnel_instance_id
            WHERE i.journey_id = $1
            GROUP BY i.funnel_instance_id, late_conversion.late_conversion_id
            ORDER BY i.entry_at, i.funnel_instance_id`,
          [journeyId],
        ),
      ])
      return Object.freeze({
        ...journeys[0], event_count: number(journeys[0].event_count),
        events: Object.freeze(events),
        evidence_summary: Object.freeze(evidence.map((row) => ({ ...row, evidence_count: number(row.evidence_count) }))),
        funnel_instances: Object.freeze(instances),
      })
    },

    async listEvents(scope, filters) {
      const window = timestampFilter(scope, "occurred_at")
      const clauses = [window.sql]
      const params = [...window.params]
      if (filters.eventClass) {
        params.push(filters.eventClass)
        clauses.push(`c.event_class = $${params.length}`)
      }
      if (filters.eventType) {
        params.push(filters.eventType)
        clauses.push(`c.event_type = $${params.length}`)
      }
      params.push(filters.limit)
      const rows = await query(
        `SELECT c.canonical_event_id, c.event_type, c.event_class, c.occurred_at,
                c.produced_at, c.ingested_at, c.normalized_at, c.persisted_at,
                c.canonical_schema_version, c.mapping_version, c.aggregate_type,
                c.quality->>'time_basis' AS time_basis,
                COALESCE((c.quality->>'authoritative_event_time')::boolean, false) AS authoritative_event_time,
                je.journey_id, je.link_method, je.link_confidence
           FROM canonical_events c
           LEFT JOIN journey_events je ON je.canonical_event_id = c.canonical_event_id
          WHERE ${clauses.join(" AND ")}
          ORDER BY c.occurred_at DESC, c.canonical_event_id
          LIMIT $${params.length}`,
        params,
      )
      return Object.freeze(rows)
    },

    async getDataHealth(scope) {
      const persistedWindow = timestampFilter(scope, "persisted_at")
      const acceptedWindow = timestampFilter(scope, "received_at", "r")
      const entryWindow = cohortFilter(scope)
      const reconciliationWindow = timestampFilter(scope, "coverage_end_at", "s")
      const [
        canonicalRows, bucketRows, projectionRows, telemetryRows,
        reconciliationRows, latestComparisonRows, repairRows,
      ] = await Promise.all([
        query(
          `SELECT COUNT(*)::bigint AS canonical_events,
                  COUNT(*) FILTER (WHERE c.event_class = 'BEHAVIOR_INTENT')::bigint AS behavior_intent,
                  COUNT(*) FILTER (WHERE c.event_class = 'CLIENT_OBSERVATION')::bigint AS client_observation,
                  COUNT(*) FILTER (WHERE c.event_class = 'BUSINESS_FACT')::bigint AS business_fact,
                  COUNT(*) FILTER (WHERE c.quality->>'authoritative_event_time' = 'true')::bigint AS authoritative_event_time,
                  COUNT(*) FILTER (WHERE c.quality->>'time_basis' = 'source_produced')::bigint AS source_produced_time,
                  COUNT(*) FILTER (WHERE c.quality->>'time_basis' = 'ingress_fallback')::bigint AS ingress_fallback_time,
                  PERCENTILE_CONT(0.5) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (c.normalized_at - c.ingested_at)) * 1000
                  ) AS normalization_latency_p50_ms,
                  PERCENTILE_CONT(0.95) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (c.normalized_at - c.ingested_at)) * 1000
                  ) AS normalization_latency_p95_ms,
                  PERCENTILE_CONT(0.95) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (c.persisted_at - c.ingested_at)) * 1000
                  ) AS canonical_persistence_latency_p95_ms,
                  MIN(c.persisted_at) AS first_persisted_at,
                  MAX(c.persisted_at) AS last_persisted_at
             FROM canonical_events c
            WHERE ${persistedWindow.sql}`,
          persistedWindow.params,
        ),
        query(
          `SELECT DATE_TRUNC('hour', c.persisted_at) AS bucket_start,
                  COUNT(*)::bigint AS canonical_events,
                  COUNT(*) FILTER (WHERE c.quality->>'authoritative_event_time' <> 'true')::bigint AS non_authoritative_time
             FROM canonical_events c
            WHERE ${persistedWindow.sql}
            GROUP BY DATE_TRUNC('hour', c.persisted_at)
            ORDER BY bucket_start DESC
            LIMIT 48`,
          persistedWindow.params,
        ),
        query(
          `SELECT COUNT(*)::bigint AS funnel_instances,
                  COUNT(*) FILTER (WHERE i.quality_status = 'PROVISIONAL')::bigint AS provisional,
                  COUNT(*) FILTER (WHERE i.quality_status = 'RECONCILING')::bigint AS reconciling,
                  COUNT(*) FILTER (WHERE i.quality_status = 'RECONCILED')::bigint AS reconciled,
                  COUNT(*) FILTER (WHERE i.quality_status = 'DEGRADED')::bigint AS degraded
             FROM funnel_kpi_instance_facts i
            WHERE ${entryWindow.sql}`,
          entryWindow.params,
        ),
        query(
          `SELECT COUNT(*)::bigint AS accepted_events,
                  COUNT(o.source_event_id)::bigint AS terminal_outcomes,
                  COUNT(*) FILTER (WHERE o.status = 'normalized')::bigint AS normalized,
                  COUNT(*) FILTER (WHERE o.status = 'unsupported')::bigint AS unsupported,
                  COUNT(*) FILTER (WHERE o.status = 'quarantined')::bigint AS quarantined,
                  PERCENTILE_CONT(0.5) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (o.processed_at - r.received_at)) * 1000
                  ) AS canonicalization_latency_p50_ms,
                  PERCENTILE_CONT(0.95) WITHIN GROUP (
                    ORDER BY EXTRACT(EPOCH FROM (o.processed_at - r.received_at)) * 1000
                  ) AS canonicalization_latency_p95_ms,
                  MIN(r.received_at) AS first_received_at,
                  MAX(r.received_at) AS last_received_at,
                  MAX(o.processed_at) AS last_processed_at
             FROM ingress_accepted_receipts r
             LEFT JOIN canonicalization_latest_outcomes o
               ON o.source_id = r.source_id AND o.source_event_id = r.event_id
            WHERE ${acceptedWindow.sql}`,
          acceptedWindow.params,
        ),
        query(
          `SELECT COUNT(*)::bigint AS snapshots,
                  COUNT(*) FILTER (WHERE COALESCE(c.window_state, s.window_state) = 'PROVISIONAL')::bigint AS provisional,
                  COUNT(*) FILTER (WHERE COALESCE(c.window_state, s.window_state) = 'RECONCILING')::bigint AS reconciling,
                  COUNT(*) FILTER (WHERE COALESCE(c.window_state, s.window_state) = 'RECONCILED')::bigint AS reconciled,
                  COUNT(*) FILTER (WHERE COALESCE(c.window_state, s.window_state) = 'DEGRADED')::bigint AS degraded,
                  COUNT(c.comparison_id)::bigint AS comparisons,
                  COUNT(c.comparison_id) FILTER (WHERE c.record_level_metrics_available)::bigint AS record_level_comparisons,
                  COALESCE(SUM(c.source_count) FILTER (WHERE c.record_level_metrics_available), 0)::bigint AS source_count,
                  COALESCE(SUM(c.analytics_count) FILTER (WHERE c.record_level_metrics_available), 0)::bigint AS analytics_count,
                  COALESCE(SUM(c.missing_count) FILTER (WHERE c.record_level_metrics_available), 0)::bigint AS missing_count,
                  COALESCE(SUM(c.phantom_count) FILTER (WHERE c.record_level_metrics_available), 0)::bigint AS phantom_count,
                  COALESCE(SUM(c.state_mismatch_count) FILTER (WHERE c.record_level_metrics_available), 0)::bigint AS state_mismatch_count,
                  COALESCE(SUM(c.amount_mismatch_count) FILTER (WHERE c.record_level_metrics_available), 0)::bigint AS amount_mismatch_count,
                  MAX(c.observed_at) AS last_compared_at
             FROM reconciliation_snapshots s
             LEFT JOIN LATERAL (
               SELECT comparison.*
                 FROM reconciliation_comparisons comparison
                WHERE comparison.source_id = s.source_id
                  AND comparison.snapshot_id = s.snapshot_id
                ORDER BY comparison.comparison_revision DESC
                LIMIT 1
             ) c ON true
            WHERE ${reconciliationWindow.sql}`,
          reconciliationWindow.params,
        ),
        query(
          `SELECT c.snapshot_id, s.entity_type, c.observed_at, c.window_state,
                  c.limitation_reason, c.revenue_deviation
             FROM reconciliation_comparisons c
             JOIN reconciliation_snapshots s
               ON s.source_id = c.source_id AND s.snapshot_id = c.snapshot_id
            WHERE ${reconciliationWindow.sql}
              AND c.comparison_revision = (
                SELECT MAX(latest.comparison_revision)
                  FROM reconciliation_comparisons latest
                 WHERE latest.source_id = c.source_id AND latest.snapshot_id = c.snapshot_id
              )
            ORDER BY c.observed_at DESC, c.snapshot_id
            LIMIT 1`,
          reconciliationWindow.params,
        ),
        query(
          `SELECT COUNT(r.repair_id)::bigint AS repairs,
                  COUNT(v.repair_id)::bigint AS verified_repairs,
                  COALESCE(SUM(v.attempted_correction_count), 0)::bigint AS attempted_corrections,
                  COALESCE(SUM(v.successful_correction_count), 0)::bigint AS successful_corrections,
                  MAX(r.repaired_at) AS last_repaired_at,
                  MAX(v.verified_at) AS last_verified_at
             FROM reconciliation_repairs r
             JOIN reconciliation_snapshots s
               ON s.source_id = r.source_id AND s.snapshot_id = r.snapshot_id
             LEFT JOIN reconciliation_repair_verifications v ON v.repair_id = r.repair_id
            WHERE ${reconciliationWindow.sql}`,
          reconciliationWindow.params,
        ),
      ])
      const canonical = canonicalRows[0] ?? {}
      const projections = projectionRows[0] ?? {}
      const telemetry = telemetryRows[0] ?? {}
      const canonicalEvents = number(canonical.canonical_events)
      const authoritative = number(canonical.authoritative_event_time)
      const acceptedEvents = number(telemetry.accepted_events)
      const terminalOutcomes = number(telemetry.terminal_outcomes)
      const reconciliation = reconciliationRows[0] ?? {}
      const repairs = repairRows[0] ?? {}
      const snapshots = number(reconciliation.snapshots)
      const comparisons = number(reconciliation.comparisons)
      const recordLevelComparisons = number(reconciliation.record_level_comparisons)
      const sourceCount = number(reconciliation.source_count)
      const analyticsCount = number(reconciliation.analytics_count)
      const attemptedCorrections = number(repairs.attempted_corrections)
      const successfulCorrections = number(repairs.successful_corrections)
      const reconciliationStates = {
        snapshots,
        provisional: number(reconciliation.provisional),
        reconciling: number(reconciliation.reconciling),
        reconciled: number(reconciliation.reconciled),
        degraded: number(reconciliation.degraded),
      }
      const latestComparison = latestComparisonRows[0] ?? null
      const unavailable = ["event_loss_rate", "duplicate_rate", "queue_drop_rate", "rejected_event_rate"]
      if (recordLevelComparisons === 0) unavailable.push("missing_rate", "phantom_rate", "state_mismatch_rate")
      if (comparisons === 0) unavailable.push("revenue_deviation")
      if (number(repairs.verified_repairs) === 0) unavailable.push("repair_success_rate")
      return Object.freeze({
        source_id: scope.sourceId,
        observation_window: Object.freeze({ basis: "persisted_at", from: scope.from, to: scope.to }),
        ingress_window: Object.freeze({ basis: "received_at", from: scope.from, to: scope.to }),
        projection_window: Object.freeze({ basis: "entry_at", from: scope.from, to: scope.to }),
        reconciliation_window: Object.freeze({ basis: "coverage_end_at", from: scope.from, to: scope.to }),
        canonicalization: Object.freeze({
          accepted_events: acceptedEvents,
          terminal_outcomes: terminalOutcomes,
          terminal_outcome_rate: rate(terminalOutcomes, acceptedEvents),
          normalized: number(telemetry.normalized),
          unsupported: number(telemetry.unsupported),
          quarantined: number(telemetry.quarantined),
          canonicalization_latency_p50_ms: telemetry.canonicalization_latency_p50_ms === null ? null : number(telemetry.canonicalization_latency_p50_ms),
          canonicalization_latency_p95_ms: telemetry.canonicalization_latency_p95_ms === null ? null : number(telemetry.canonicalization_latency_p95_ms),
          first_received_at: telemetry.first_received_at ?? null,
          last_received_at: telemetry.last_received_at ?? null,
          last_processed_at: telemetry.last_processed_at ?? null,
        }),
        canonical: Object.freeze({
          events: canonicalEvents,
          behavior_intent: number(canonical.behavior_intent),
          client_observation: number(canonical.client_observation),
          business_fact: number(canonical.business_fact),
          authoritative_event_time: authoritative,
          authoritative_event_time_rate: rate(authoritative, canonicalEvents),
          source_produced_time: number(canonical.source_produced_time),
          ingress_fallback_time: number(canonical.ingress_fallback_time),
          normalization_latency_p50_ms: canonical.normalization_latency_p50_ms === null ? null : number(canonical.normalization_latency_p50_ms),
          normalization_latency_p95_ms: canonical.normalization_latency_p95_ms === null ? null : number(canonical.normalization_latency_p95_ms),
          canonical_persistence_latency_p95_ms: canonical.canonical_persistence_latency_p95_ms === null ? null : number(canonical.canonical_persistence_latency_p95_ms),
          first_persisted_at: canonical.first_persisted_at ?? null,
          last_persisted_at: canonical.last_persisted_at ?? null,
        }),
        hourly: Object.freeze(bucketRows.reverse().map((row) => ({
          bucket_start: row.bucket_start,
          canonical_events: number(row.canonical_events),
          non_authoritative_time: number(row.non_authoritative_time),
        }))),
        projection_quality: Object.freeze({
          funnel_instances: number(projections.funnel_instances),
          provisional: number(projections.provisional),
          reconciling: number(projections.reconciling),
          reconciled: number(projections.reconciled),
          degraded: number(projections.degraded),
        }),
        reconciliation: Object.freeze({
          ...reconciliationStates,
          comparisons,
          record_level_comparisons: recordLevelComparisons,
          source_count: sourceCount,
          analytics_count: analyticsCount,
          source_denominator_empty: sourceCount === 0,
          analytics_denominator_empty: analyticsCount === 0,
          missing_count: number(reconciliation.missing_count),
          phantom_count: number(reconciliation.phantom_count),
          state_mismatch_count: number(reconciliation.state_mismatch_count),
          amount_mismatch_count: number(reconciliation.amount_mismatch_count),
          missing_rate: recordLevelComparisons === 0 ? null : rate(reconciliation.missing_count, sourceCount),
          phantom_rate: recordLevelComparisons === 0 ? null : rate(reconciliation.phantom_count, analyticsCount),
          state_mismatch_rate: recordLevelComparisons === 0 ? null : rate(reconciliation.state_mismatch_count, sourceCount),
          last_compared_at: reconciliation.last_compared_at ?? null,
          latest_comparison: latestComparison ? Object.freeze({
            snapshot_id: latestComparison.snapshot_id,
            entity_type: latestComparison.entity_type,
            observed_at: latestComparison.observed_at,
            window_state: latestComparison.window_state,
            limitation_reason: latestComparison.limitation_reason,
            revenue_deviation: Object.freeze(latestComparison.revenue_deviation),
          }) : null,
          repairs: number(repairs.repairs),
          verified_repairs: number(repairs.verified_repairs),
          attempted_corrections: attemptedCorrections,
          successful_corrections: successfulCorrections,
          repair_denominator_empty: attemptedCorrections === 0,
          repair_success_rate: number(repairs.verified_repairs) === 0
            ? null
            : rate(successfulCorrections, attemptedCorrections),
          last_repaired_at: repairs.last_repaired_at ?? null,
          last_verified_at: repairs.last_verified_at ?? null,
          quality_gate: reconciliationGate(reconciliationStates),
        }),
        unavailable_metrics: Object.freeze(unavailable),
      })
    },
  })
}
