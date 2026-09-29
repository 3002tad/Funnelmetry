export function canonicalEvent(overrides = {}) {
  return {
    canonical_event_id: "can_1",
    source_id: "source-one",
    source_event_id: "source:evt-1",
    event_type: "behavior.product_viewed",
    event_class: "BEHAVIOR_INTENT",
    canonical_schema_version: "canonical-event.v1",
    mapping_version: "passthrough-v1",
    occurred_at: "2026-08-29T01:00:00.000Z",
    produced_at: "2026-08-29T01:00:01.000Z",
    ingested_at: "2026-08-29T01:00:02.000Z",
    normalized_at: "2026-08-29T01:00:03.000Z",
    identity: { session_id: "session_1" },
    relations: { correlation_id: "corr_1" },
    data: {},
    quality: { time_basis: "source_occurred", authoritative_event_time: true },
    source_reference: { raw_record_id: "raw_1", content_hash: "a".repeat(64), byte_size: 100 },
    ...overrides,
  }
}

// Legacy merchant-acceptance fixture, NOT the Medusa reference Commerce profile.
// Kept to test generic evaluator compatibility; current reference tested separately.
export const commerceProfile = Object.freeze({
  funnel_profile_id: "commerce",
  profile_version: "1.0.0",
  display_name: "Commerce conversion",
  subject_scope: "JOURNEY",
  entry_event_type: "behavior.product_viewed",
  conversion_horizon_seconds: null,
  late_arrival_grace_seconds: null,
  ordered_steps: [
    { step_id: "view", event_type: "behavior.product_viewed", event_class: "BEHAVIOR_INTENT" },
    { step_id: "cart", event_type: "cart.item_added", event_class: "BUSINESS_FACT" },
    { step_id: "checkout", event_type: "checkout.started", event_class: "BEHAVIOR_INTENT" },
    { step_id: "order", event_type: "order.accepted", event_class: "BUSINESS_FACT" },
  ],
  negative_events: ["order.cancelled"],
})
