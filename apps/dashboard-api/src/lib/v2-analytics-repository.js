function number(value) {
  return Number(value ?? 0)
}

function rate(numerator, denominator) {
  const total = number(denominator)
  return total === 0 ? null : number(numerator) / total
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
                COUNT(*) FILTER (WHERE i.quality_status = 'PROVISIONAL')::bigint AS provisional,
                COUNT(*) FILTER (WHERE i.quality_status = 'RECONCILING')::bigint AS reconciling,
                COUNT(*) FILTER (WHERE i.quality_status = 'RECONCILED')::bigint AS reconciled,
                COUNT(*) FILTER (WHERE i.quality_status = 'DEGRADED')::bigint AS degraded,
                MIN(i.entry_at) AS first_entry_at,
                MAX(i.entry_at) AS last_entry_at
           FROM funnel_kpi_instance_facts i
           JOIN funnel_profiles p
             ON p.funnel_profile_id = i.funnel_profile_id AND p.profile_version = i.profile_version
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
                COUNT(*) FILTER (WHERE i.quality_status = 'PROVISIONAL')::bigint AS provisional,
                COUNT(*) FILTER (WHERE i.quality_status = 'RECONCILING')::bigint AS reconciling,
                COUNT(*) FILTER (WHERE i.quality_status = 'RECONCILED')::bigint AS reconciled,
                COUNT(*) FILTER (WHERE i.quality_status = 'DEGRADED')::bigint AS degraded,
                MIN(i.entry_at) AS first_entry_at, MAX(i.entry_at) AS last_entry_at
           FROM funnel_kpi_instance_facts i
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
                  'converted_at', instances.converted_at
                )) FILTER (WHERE instances.funnel_instance_id IS NOT NULL), '[]'::jsonb) AS funnel_instances
           FROM journeys j
           LEFT JOIN journey_entities entities ON entities.journey_id = j.journey_id
           LEFT JOIN funnel_instances instances ON instances.journey_id = j.journey_id
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
                  COALESCE(jsonb_agg(jsonb_build_object(
                    'step_index', s.step_index, 'step_id', s.step_id, 'event_type', s.event_type,
                    'first_reached_at', s.first_reached_at, 'last_reached_at', s.last_reached_at,
                    'occurrence_count', s.occurrence_count, 'sequence_status', s.sequence_status
                  ) ORDER BY s.step_index) FILTER (WHERE s.step_index IS NOT NULL), '[]'::jsonb) AS steps
             FROM funnel_instances i
             LEFT JOIN funnel_instance_steps s ON s.funnel_instance_id = i.funnel_instance_id
            WHERE i.journey_id = $1
            GROUP BY i.funnel_instance_id
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
      const entryWindow = cohortFilter(scope)
      const [canonicalRows, bucketRows, projectionRows] = await Promise.all([
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
      ])
      const canonical = canonicalRows[0] ?? {}
      const projections = projectionRows[0] ?? {}
      const canonicalEvents = number(canonical.canonical_events)
      const authoritative = number(canonical.authoritative_event_time)
      return Object.freeze({
        source_id: scope.sourceId,
        observation_window: Object.freeze({ basis: "persisted_at", from: scope.from, to: scope.to }),
        projection_window: Object.freeze({ basis: "entry_at", from: scope.from, to: scope.to }),
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
        unavailable_metrics: Object.freeze([
          "event_loss_rate", "duplicate_rate", "queue_drop_rate", "rejected_event_rate",
          "convergence_lag", "missing_rate", "phantom_rate", "state_mismatch_rate", "revenue_deviation",
        ]),
      })
    },
  })
}
