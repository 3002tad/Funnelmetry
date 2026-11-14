\pset pager off
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout='15s';
SET LOCAL lock_timeout='2s';
SELECT json_build_object('checked_at',now(),'database',current_database(),'read_only',current_setting('transaction_read_only'));
SELECT json_build_object('snapshots_all_sources',count(*),'snapshot_sources',count(DISTINCT source_id)) FROM reconciliation_snapshots;
SELECT json_build_object('source','medusa-reference','snapshots_all_time',count(*),'earliest_coverage_end',min(coverage_end_at),'latest_coverage_end',max(coverage_end_at),'snapshots_selected_window',count(*) FILTER (WHERE coverage_end_at >= '2026-10-16T00:00:00.000Z'::timestamptz AND coverage_end_at < '2026-11-15T00:00:00.000Z'::timestamptz)) FROM reconciliation_snapshots WHERE source_id='medusa-reference';
SELECT json_build_object('comparisons_all_sources',count(*)) FROM reconciliation_comparisons;
SELECT json_build_object('profile',p.funnel_profile_id,'version',p.profile_version,'horizon',p.conversion_horizon_seconds,'grace',p.late_arrival_grace_seconds,'disabled_at',a.disabled_at) FROM funnel_profiles p JOIN funnel_profile_activations a USING(funnel_profile_id,profile_version) WHERE a.source_id='medusa-reference';
SELECT 'QUERY_1';
SELECT p.funnel_profile_id, p.profile_version, p.display_name, p.subject_scope,
              p.entry_event_type, p.conversion_horizon_seconds, p.late_arrival_grace_seconds,
              p.published_at, a.disabled_at
         FROM funnel_profiles p
         JOIN funnel_profile_activations a
           ON a.funnel_profile_id = p.funnel_profile_id AND a.profile_version = p.profile_version
        WHERE a.source_id = 'medusa-reference' AND p.funnel_profile_id = 'commerce-conversion' AND p.profile_version = '2.0.0'
        ORDER BY p.published_at DESC
        LIMIT 1;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT p.funnel_profile_id, p.profile_version, p.display_name, p.subject_scope,
              p.entry_event_type, p.conversion_horizon_seconds, p.late_arrival_grace_seconds,
              p.published_at, a.disabled_at
         FROM funnel_profiles p
         JOIN funnel_profile_activations a
           ON a.funnel_profile_id = p.funnel_profile_id AND a.profile_version = p.profile_version
        WHERE a.source_id = 'medusa-reference' AND p.funnel_profile_id = 'commerce-conversion' AND p.profile_version = '2.0.0'
        ORDER BY p.published_at DESC
        LIMIT 1;
SELECT 'QUERY_2';
SELECT COUNT(*)::bigint AS entrants,
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
          WHERE i.source_id = 'medusa-reference' AND i.entry_at >= '2026-10-16T00:00:00.000Z'::timestamptz AND i.entry_at < '2026-11-15T00:00:00.000Z'::timestamptz
            AND i.funnel_profile_id = 'commerce-conversion'
            AND i.profile_version = '2.0.0';
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT COUNT(*)::bigint AS entrants,
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
          WHERE i.source_id = 'medusa-reference' AND i.entry_at >= '2026-10-16T00:00:00.000Z'::timestamptz AND i.entry_at < '2026-11-15T00:00:00.000Z'::timestamptz
            AND i.funnel_profile_id = 'commerce-conversion'
            AND i.profile_version = '2.0.0';
SELECT 'QUERY_3';
SELECT steps.step_index, steps.step_id, steps.event_type, steps.event_class,
                COUNT(instances.funnel_instance_id)::bigint AS entrants,
                COUNT(reached.funnel_instance_id)::bigint AS reached
           FROM funnel_profile_steps steps
           LEFT JOIN funnel_kpi_instance_facts instances
             ON instances.funnel_profile_id = steps.funnel_profile_id
            AND instances.profile_version = steps.profile_version
            AND instances.source_id = 'medusa-reference' AND instances.entry_at >= '2026-10-16T00:00:00.000Z'::timestamptz AND instances.entry_at < '2026-11-15T00:00:00.000Z'::timestamptz
           LEFT JOIN funnel_kpi_step_facts reached
             ON reached.funnel_instance_id = instances.funnel_instance_id
            AND reached.step_index = steps.step_index
          WHERE steps.funnel_profile_id = 'commerce-conversion'
            AND steps.profile_version = '2.0.0'
          GROUP BY steps.step_index, steps.step_id, steps.event_type, steps.event_class
          ORDER BY steps.step_index;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT steps.step_index, steps.step_id, steps.event_type, steps.event_class,
                COUNT(instances.funnel_instance_id)::bigint AS entrants,
                COUNT(reached.funnel_instance_id)::bigint AS reached
           FROM funnel_profile_steps steps
           LEFT JOIN funnel_kpi_instance_facts instances
             ON instances.funnel_profile_id = steps.funnel_profile_id
            AND instances.profile_version = steps.profile_version
            AND instances.source_id = 'medusa-reference' AND instances.entry_at >= '2026-10-16T00:00:00.000Z'::timestamptz AND instances.entry_at < '2026-11-15T00:00:00.000Z'::timestamptz
           LEFT JOIN funnel_kpi_step_facts reached
             ON reached.funnel_instance_id = instances.funnel_instance_id
            AND reached.step_index = steps.step_index
          WHERE steps.funnel_profile_id = 'commerce-conversion'
            AND steps.profile_version = '2.0.0'
          GROUP BY steps.step_index, steps.step_id, steps.event_type, steps.event_class
          ORDER BY steps.step_index;
SELECT 'QUERY_4';
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT COUNT(*)::bigint AS canonical_events,
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
            WHERE c.source_id = 'medusa-reference' AND c.persisted_at >= '2026-10-16T00:00:00.000Z'::timestamptz AND c.persisted_at < '2026-11-15T00:00:00.000Z'::timestamptz;
SELECT 'QUERY_5';
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT DATE_TRUNC('hour', c.persisted_at) AS bucket_start,
                  COUNT(*)::bigint AS canonical_events,
                  COUNT(*) FILTER (WHERE c.quality->>'authoritative_event_time' <> 'true')::bigint AS non_authoritative_time
             FROM canonical_events c
            WHERE c.source_id = 'medusa-reference' AND c.persisted_at >= '2026-10-16T00:00:00.000Z'::timestamptz AND c.persisted_at < '2026-11-15T00:00:00.000Z'::timestamptz
            GROUP BY DATE_TRUNC('hour', c.persisted_at)
            ORDER BY bucket_start DESC
            LIMIT 48;
SELECT 'QUERY_6';
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT COUNT(*)::bigint AS funnel_instances,
                  COUNT(*) FILTER (WHERE i.quality_status = 'PROVISIONAL')::bigint AS provisional,
                  COUNT(*) FILTER (WHERE i.quality_status = 'RECONCILING')::bigint AS reconciling,
                  COUNT(*) FILTER (WHERE i.quality_status = 'RECONCILED')::bigint AS reconciled,
                  COUNT(*) FILTER (WHERE i.quality_status = 'DEGRADED')::bigint AS degraded
             FROM funnel_kpi_instance_facts i
            WHERE i.source_id = 'medusa-reference' AND i.entry_at >= '2026-10-16T00:00:00.000Z'::timestamptz AND i.entry_at < '2026-11-15T00:00:00.000Z'::timestamptz;
SELECT 'QUERY_7';
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT COUNT(*)::bigint AS accepted_events,
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
            WHERE r.source_id = 'medusa-reference' AND r.received_at >= '2026-10-16T00:00:00.000Z'::timestamptz AND r.received_at < '2026-11-15T00:00:00.000Z'::timestamptz;
SELECT 'QUERY_8';
SELECT COUNT(*)::bigint AS snapshots,
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
            WHERE s.source_id = 'medusa-reference' AND s.coverage_end_at >= '2026-10-16T00:00:00.000Z'::timestamptz AND s.coverage_end_at < '2026-11-15T00:00:00.000Z'::timestamptz;
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT COUNT(*)::bigint AS snapshots,
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
            WHERE s.source_id = 'medusa-reference' AND s.coverage_end_at >= '2026-10-16T00:00:00.000Z'::timestamptz AND s.coverage_end_at < '2026-11-15T00:00:00.000Z'::timestamptz;
SELECT 'QUERY_9';
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT c.snapshot_id, s.entity_type, c.observed_at, c.window_state,
                  c.limitation_reason, c.revenue_deviation
             FROM reconciliation_comparisons c
             JOIN reconciliation_snapshots s
               ON s.source_id = c.source_id AND s.snapshot_id = c.snapshot_id
            WHERE s.source_id = 'medusa-reference' AND s.coverage_end_at >= '2026-10-16T00:00:00.000Z'::timestamptz AND s.coverage_end_at < '2026-11-15T00:00:00.000Z'::timestamptz
              AND c.comparison_revision = (
                SELECT MAX(latest.comparison_revision)
                  FROM reconciliation_comparisons latest
                 WHERE latest.source_id = c.source_id AND latest.snapshot_id = c.snapshot_id
              )
            ORDER BY c.observed_at DESC, c.snapshot_id
            LIMIT 1;
SELECT 'QUERY_10';
EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) SELECT COUNT(r.repair_id)::bigint AS repairs,
                  COUNT(v.repair_id)::bigint AS verified_repairs,
                  COALESCE(SUM(v.attempted_correction_count), 0)::bigint AS attempted_corrections,
                  COALESCE(SUM(v.successful_correction_count), 0)::bigint AS successful_corrections,
                  MAX(r.repaired_at) AS last_repaired_at,
                  MAX(v.verified_at) AS last_verified_at
             FROM reconciliation_repairs r
             JOIN reconciliation_snapshots s
               ON s.source_id = r.source_id AND s.snapshot_id = r.snapshot_id
             LEFT JOIN reconciliation_repair_verifications v ON v.repair_id = r.repair_id
            WHERE s.source_id = 'medusa-reference' AND s.coverage_end_at >= '2026-10-16T00:00:00.000Z'::timestamptz AND s.coverage_end_at < '2026-11-15T00:00:00.000Z'::timestamptz;
ROLLBACK;