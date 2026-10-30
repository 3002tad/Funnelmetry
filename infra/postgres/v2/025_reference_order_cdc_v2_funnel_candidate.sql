-- Read-only, retractable funnel terminal candidate for the Medusa reference.
-- This is not a published Funnel Profile and never aliases order.placed.
-- Current state, quality lease and cart/checkout evidence are evaluated on
-- every read, so an OFF or expired lease immediately removes a prior terminal.
CREATE VIEW reference_cdc_v2_funnel_terminal_candidate AS
SELECT s.source_instance_id, s.coverage_epoch_id, s.order_id, s.cart_id,
       cart_journey.journey_id, checkout.canonical_event_id AS checkout_event_id,
       on_record.record_id AS on_record_id,
       on_record.payload->>'observed_state_at' AS observed_state_at,
       s.last_record_id, s.last_topic_offset,
       'reference.medusa.order_recorded_state.v2'::text AS contract_id,
       'INCOMPLETE'::text AS historical_gap_status
FROM reference_cdc_v2_order_current_state_readable s
JOIN reference_cdc_v2_record_inbox current_record
  ON current_record.record_id = s.last_record_id
JOIN LATERAL (
  SELECT r.record_id, r.payload
  FROM reference_cdc_v2_record_inbox r
  WHERE r.source_instance_id = s.source_instance_id
    AND r.coverage_epoch_id = s.coverage_epoch_id
    AND r.order_id = s.order_id
    AND r.fact_topic = current_record.fact_topic
    AND r.kafka_partition = current_record.kafka_partition
    AND r.record_type = 'TRANSITION'
    AND r.payload->>'active' = 'true'
    AND r.kafka_offset <= s.last_topic_offset
  ORDER BY r.kafka_offset DESC LIMIT 1
) on_record ON true
JOIN LATERAL (
  SELECT r.record_id
  FROM reference_cdc_v2_record_inbox r
  WHERE r.source_instance_id = s.source_instance_id
    AND r.coverage_epoch_id = s.coverage_epoch_id
    AND r.order_id = s.order_id
    AND r.fact_topic = current_record.fact_topic
    AND r.kafka_partition = current_record.kafka_partition
    AND r.record_type = 'TRANSITION'
    AND r.kafka_offset <= s.last_topic_offset
  ORDER BY r.kafka_offset DESC LIMIT 1
) latest_transition ON latest_transition.record_id = on_record.record_id
JOIN LATERAL (
  SELECT min(e.journey_id) AS journey_id
  FROM journey_entities e
  JOIN journeys j ON j.journey_id = e.journey_id
  WHERE e.source_id = s.source_instance_id
    AND j.source_id = e.source_id
    AND e.entity_type = 'CART'
    AND e.entity_key = s.cart_id
    AND e.link_confidence = 'STRONG'
  HAVING count(DISTINCT e.journey_id) = 1
) cart_journey ON true
JOIN LATERAL (
  SELECT c.canonical_event_id
  FROM journey_events je
  JOIN canonical_events c ON c.canonical_event_id = je.canonical_event_id
  WHERE je.journey_id = cart_journey.journey_id
    AND c.source_id = s.source_instance_id
    AND c.event_type = 'checkout.started'
    AND (c.relations->>'cart_id' = s.cart_id OR
         c.relations->>'correlation_id' = 'cart:' || s.cart_id)
    AND (c.relations->>'cart_id' IS NULL OR c.relations->>'cart_id' = s.cart_id)
    AND (c.relations->>'correlation_id' IS NULL OR
         c.relations->>'correlation_id' = 'cart:' || s.cart_id)
  ORDER BY c.occurred_at DESC, c.canonical_event_id DESC LIMIT 1
) checkout ON true
WHERE s.active
  AND on_record.payload->>'cart_id' = s.cart_id
  AND on_record.payload->>'observed_state_at' IS NOT NULL;
