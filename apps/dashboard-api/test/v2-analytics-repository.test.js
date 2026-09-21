import test from "node:test"
import assert from "node:assert/strict"
import { createV2AnalyticsRepository } from "../src/lib/v2-analytics-repository.js"

test("returns observed profile cohorts without claiming a final conversion rate", async () => {
  const calls = []
  const repository = createV2AnalyticsRepository({ query: async (sql, params) => {
    calls.push({ sql, params })
    return [{
      funnel_profile_id: "commerce-conversion", profile_version: "1.0.0", display_name: "Commerce",
      entrants: "4", observed_converted: "1", pending: "2", dropped: "1", terminated: "0", invalid: "0",
      matured_converted: "1", finalized_dropped: "1", late_conversions: "1",
      too_late_for_final_cohort: "0", after_horizon: "1",
      provisional: "3", reconciling: "0", reconciled: "1", degraded: "0",
      first_entry_at: "2026-08-01T00:00:00.000Z", last_entry_at: "2026-08-02T00:00:00.000Z",
    }]
  } })
  const result = await repository.getOverview({
    sourceId: "medusa-reference", from: "2026-08-01T00:00:00.000Z", to: null,
  })
  assert.equal(result.metric_state, "OBSERVED")
  assert.equal(result.cohort.basis, "entry_at")
  assert.equal(result.profiles[0].observed_end_to_end_rate, 0.25)
  assert.equal(result.profiles[0].late_conversion_rate, 1)
  assert.equal(result.profiles[0].eligible_matured, 2)
  assert.equal(result.profiles[0].final_end_to_end_rate, 0.5)
  assert.equal(result.profiles[0].final_dropoff_rate, 0.5)
  assert.equal(result.profiles[0].after_horizon, 1)
  assert.equal(result.profiles[0].provisional, 3)
  assert.match(calls[0].sql, /funnel_kpi_instance_facts/)
  assert.match(calls[0].sql, /funnel_late_conversions/)
  assert.match(calls[0].sql, /funnel_instance_latest_maturity/)
  assert.doesNotMatch(calls[0].sql, /tracking_kpi_1m/)
  assert.deepEqual(calls[0].params, ["medusa-reference", "2026-08-01T00:00:00.000Z"])
})

test("resolves an active profile version and preserves zero-denominator step state", async () => {
  const calls = []
  const responses = [
    [{
      funnel_profile_id: "commerce-conversion", profile_version: "1.0.0", display_name: "Commerce",
      subject_scope: "JOURNEY", entry_event_type: "behavior.product_viewed",
      conversion_horizon_seconds: null, late_arrival_grace_seconds: null,
      published_at: "2026-08-01T00:00:00.000Z",
    }],
    [{
      entrants: "0", observed_converted: "0", pending: "0", dropped: "0", provisional: "0",
      reconciled: "0", degraded: "0", finalized_dropped: "0", late_conversions: "0",
      matured_converted: "0", too_late_for_final_cohort: "0", after_horizon: "0",
    }],
    [{ step_index: 0, step_id: "view", event_type: "behavior.product_viewed", event_class: "BEHAVIOR_INTENT", entrants: "0", reached: "0" }],
  ]
  const repository = createV2AnalyticsRepository({ query: async (sql, params) => {
    calls.push({ sql, params })
    return responses.shift()
  } })
  const result = await repository.getFunnel(
    { sourceId: "medusa-reference", from: null, to: null },
    { profileId: "commerce-conversion", version: null },
  )
  assert.equal(result.steps[0].observed_reach_rate, null)
  assert.equal(result.totals.observed_end_to_end_rate, null)
  assert.equal(result.totals.late_conversion_rate, null)
  assert.equal(result.totals.final_end_to_end_rate, null)
  assert.match(calls[2].sql, /instances\.source_id = \$1/)
  assert.deepEqual(calls[2].params, ["medusa-reference", "commerce-conversion", "1.0.0"])
})

test("journey detail exposes evidence summaries but never entity keys or canonical payload data", async () => {
  const calls = []
  const responses = [
    [{ journey_id: "journey_1", source_id: "medusa-reference", status: "ACTIVE", event_count: "2" }],
    [{ canonical_event_id: "can_1", event_type: "behavior.product_viewed", event_class: "BEHAVIOR_INTENT", quality: {} }],
    [{ entity_type: "SESSION", link_method: "SESSION_CONTEXT", link_confidence: "WEAK", evidence_count: 1 }],
    [{
      funnel_instance_id: "funnel_1",
      late_conversion: {
        late_conversion_id: "late_1", arrival_class: "AFTER_HORIZON",
        matched_entity_type: "ORDER",
      },
      steps: [],
    }],
  ]
  const repository = createV2AnalyticsRepository({ query: async (sql) => {
    calls.push(sql)
    return responses.shift()
  } })
  const result = await repository.getJourney("medusa-reference", "journey_1")
  assert.equal(result.event_count, 2)
  assert.deepEqual(result.evidence_summary[0], {
    entity_type: "SESSION", link_method: "SESSION_CONTEXT", link_confidence: "WEAK", evidence_count: 1,
  })
  assert.equal("entity_key" in result.evidence_summary[0], false)
  assert.equal("data" in result.events[0], false)
  assert.equal(result.funnel_instances[0].late_conversion.arrival_class, "AFTER_HORIZON")
  assert.equal("matched_entity_key" in result.funnel_instances[0].late_conversion, false)
  assert.doesNotMatch(calls[2], /entity_key/)
  assert.doesNotMatch(calls[1], /canonical_document|c\.data/)
  assert.doesNotMatch(calls[3], /matched_entity_key|late_conversion_document/)
})

test("event browser returns allowlisted business details but not raw payload or identity", async () => {
  const calls = []
  const repository = createV2AnalyticsRepository({ query: async (sql, params) => {
    calls.push({ sql, params })
    return [{
      canonical_event_id: "can_1", event_type: "order.accepted", event_class: "BUSINESS_FACT",
      time_basis: "source_occurred", authoritative_event_time: true, journey_id: "journey_1",
      private_business_data: { order_id: 'order_1', total_minor: 1200, currency_code: 'usd', email: 'secret@example.test', items: [{ product_id: 'prod_1', unit_price_minor: 1200, quantity: 1, customer_email: 'secret@example.test' }] },
    }]
  } })
  const events = await repository.listEvents(
    { sourceId: "medusa-reference", from: null, to: null },
    { eventClass: "BUSINESS_FACT", eventType: null, limit: 25 },
  )
  assert.equal(events[0].event_type, "order.accepted")
  assert.equal("data" in events[0], false)
  assert.equal('private_business_data' in events[0], false)
  assert.equal(events[0].business_details.total_minor, 1200)
  assert.equal(JSON.stringify(events).includes('secret@example.test'), false)
  assert.doesNotMatch(calls[0].sql, /c\.identity|aggregate_id|canonical_document/)
  assert.deepEqual(calls[0].params, ["medusa-reference", "BUSINESS_FACT", 25])
})

test("data health reports durable canonicalization, canonical and projection evidence", async () => {
  const responses = [
    [{
      canonical_events: "10", behavior_intent: "6", client_observation: "1", business_fact: "3",
      authoritative_event_time: "8", source_produced_time: "1", ingress_fallback_time: "1",
      normalization_latency_p50_ms: "12", normalization_latency_p95_ms: "30",
      canonical_persistence_latency_p95_ms: "45", first_persisted_at: "2026-08-01Z", last_persisted_at: "2026-08-02Z",
    }],
    [{ bucket_start: "2026-08-01Z", canonical_events: "10", non_authoritative_time: "2" }],
    [{ funnel_instances: "4", provisional: "2", reconciling: "1", reconciled: "1", degraded: "0" }],
    [{
      accepted_events: "12", terminal_outcomes: "10", normalized: "8", unsupported: "1", quarantined: "1",
      canonicalization_latency_p50_ms: "18", canonicalization_latency_p95_ms: "55",
      first_received_at: "2026-08-01Z", last_received_at: "2026-08-02Z", last_processed_at: "2026-08-02Z",
    }],
    [{
      snapshots: "2", provisional: "0", reconciling: "1", reconciled: "1", degraded: "0",
      comparisons: "2", record_level_comparisons: "2", source_count: "10", analytics_count: "9",
      missing_count: "1", phantom_count: "0", state_mismatch_count: "1", amount_mismatch_count: "0",
      last_compared_at: "2026-08-03Z",
    }],
    [{
      snapshot_id: "snapshot-2", entity_type: "ORDER", observed_at: "2026-08-03Z",
      window_state: "RECONCILING", limitation_reason: null,
      revenue_deviation: [{
        currency: "VND", source_amount: "100", analytics_amount: "90",
        absolute_deviation: "10", deviation_rate: "0.1", denominator_empty: false,
      }],
    }],
    [{
      repairs: "1", verified_repairs: "1", attempted_corrections: "2",
      successful_corrections: "2", last_repaired_at: "2026-08-03Z", last_verified_at: "2026-08-03Z",
    }],
  ]
  const repository = createV2AnalyticsRepository({ query: async () => responses.shift() })
  const result = await repository.getDataHealth({ sourceId: "medusa-reference", from: null, to: null })
  assert.equal(result.canonical.authoritative_event_time_rate, 0.8)
  assert.equal(result.canonical.normalization_latency_p95_ms, 30)
  assert.equal(result.canonicalization.terminal_outcome_rate, 10 / 12)
  assert.equal(result.canonicalization.unsupported, 1)
  assert.equal(result.ingress_window.basis, "received_at")
  assert.equal(result.projection_quality.provisional, 2)
  assert.equal(result.reconciliation.missing_rate, 0.1)
  assert.equal(result.reconciliation.repair_success_rate, 1)
  assert.equal(result.reconciliation.quality_gate.state, "RECONCILING")
  assert.equal(result.reconciliation.quality_gate.eligible_for_authoritative_business_analysis, false)
  assert.equal(result.unavailable_metrics.includes("missing_rate"), false)
  assert.ok(result.unavailable_metrics.includes("event_loss_rate"))
  assert.equal(result.unavailable_metrics.includes("convergence_lag"), false)
  assert.equal("accepted_event_rate" in result.canonical, false)
})

test("data health gates authoritative analysis when reconciliation evidence is degraded", async () => {
  const responses = [
    [{}],
    [],
    [{}],
    [{}],
    [{
      snapshots: "2", provisional: "1", reconciling: "0", reconciled: "0", degraded: "1",
      comparisons: "1", record_level_comparisons: "0", source_count: "0", analytics_count: "0",
      missing_count: "0", phantom_count: "0", state_mismatch_count: "0", amount_mismatch_count: "0",
    }],
    [{
      snapshot_id: "snapshot-degraded", entity_type: "ORDER", observed_at: "2026-08-03Z",
      window_state: "DEGRADED", limitation_reason: "AGGREGATE_ONLY", revenue_deviation: [],
    }],
    [{}],
  ]
  const repository = createV2AnalyticsRepository({ query: async () => responses.shift() })

  const result = await repository.getDataHealth({ sourceId: "medusa-reference", from: null, to: null })

  assert.equal(result.reconciliation.quality_gate.state, "DEGRADED")
  assert.equal(result.reconciliation.quality_gate.eligible_for_authoritative_business_analysis, false)
  assert.deepEqual(result.reconciliation.quality_gate.reasons, ["DEGRADED_WINDOW"])
  assert.equal(result.reconciliation.missing_rate, null)
  assert.ok(result.unavailable_metrics.includes("missing_rate"))
})

test("data health reports an unavailable gate when no reconciliation snapshot exists", async () => {
  const responses = [[{}], [], [{}], [{}], [{}], [], [{}]]
  const repository = createV2AnalyticsRepository({ query: async () => responses.shift() })

  const result = await repository.getDataHealth({ sourceId: "medusa-reference", from: null, to: null })

  assert.equal(result.reconciliation.quality_gate.state, "UNAVAILABLE")
  assert.equal(result.reconciliation.quality_gate.eligible_for_authoritative_business_analysis, false)
  assert.deepEqual(result.reconciliation.quality_gate.reasons, ["NO_RECONCILIATION_EVIDENCE"])
  assert.ok(result.unavailable_metrics.includes("revenue_deviation"))
})
