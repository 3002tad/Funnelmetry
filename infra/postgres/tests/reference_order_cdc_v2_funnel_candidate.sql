-- Candidate-only regression: baseline never converts, ON binds, OFF retracts,
-- and an expired quality lease hides a restored terminal. No live profile.
BEGIN;

INSERT INTO canonical_events (
  canonical_event_id, source_id, source_event_id, event_type, event_class,
  canonical_schema_version, mapping_version, occurred_at, ingested_at,
  normalized_at, relations, data, quality, raw_record_id, raw_content_hash,
  raw_byte_size, canonical_document
) VALUES (
  'cdc25_checkout', 'medusa-reference', 'cdc25_checkout_source',
  'checkout.started', 'BEHAVIOR_INTENT', '2.0', 'v2',
  clock_timestamp(), clock_timestamp(), clock_timestamp(),
  '{"correlation_id":"cart:cdc25_cart"}'::jsonb,
  '{}'::jsonb, '{}'::jsonb, 'cdc25_raw', repeat('a',64), 0, '{}'::jsonb
);
INSERT INTO journeys (journey_id, source_id, first_event_at, last_event_at)
VALUES ('cdc25_journey', 'medusa-reference', clock_timestamp(), clock_timestamp());
INSERT INTO journey_entities (
  source_id, entity_type, entity_key, journey_id, linked_at, link_method,
  link_confidence, evidence_event_id
) VALUES (
  'medusa-reference','CART','cdc25_cart','cdc25_journey',clock_timestamp(),
  'CART_ID','STRONG','cdc25_checkout'
);
INSERT INTO journey_events (
  canonical_event_id, journey_id, event_type, occurred_at, link_method,
  link_confidence, matched_entity_type, matched_entity_key, linked_at
) VALUES (
  'cdc25_checkout','cdc25_journey','checkout.started',clock_timestamp(),
  'CART_ID','STRONG','CART','cdc25_cart',clock_timestamp()
);
INSERT INTO reference_cdc_v2_quality_state (
  source_instance_id,coverage_epoch_id,status,historical_gap_status,
  baseline_complete,reason,verified_at,valid_until
) VALUES (
  'medusa-reference','cdc25_epoch','CURRENT_STATE_READY','INCOMPLETE',
  true,'TEST_ONLY',clock_timestamp(),clock_timestamp()+interval '1 hour'
);
INSERT INTO reference_cdc_v2_record_inbox (
  record_id,source_instance_id,coverage_epoch_id,fact_topic,order_id,
  record_type,payload,kafka_partition,kafka_offset
) VALUES (
  'cdc25_baseline','medusa-reference','cdc25_epoch','cdc25_fact',
  'cdc25_order','BASELINE',
  '{"cart_id":"cdc25_cart","active":true}'::jsonb,0,0
);
INSERT INTO reference_cdc_v2_order_current_state (
  source_instance_id,coverage_epoch_id,order_id,cart_id,active,
  last_record_id,last_topic_offset
) VALUES (
  'medusa-reference','cdc25_epoch','cdc25_order','cdc25_cart',true,
  'cdc25_baseline',0
);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM reference_cdc_v2_funnel_terminal_candidate
             WHERE coverage_epoch_id='cdc25_epoch')
  THEN RAISE EXCEPTION 'baseline created a terminal'; END IF;
END $$;

INSERT INTO reference_cdc_v2_record_inbox (
  record_id,source_instance_id,coverage_epoch_id,fact_topic,order_id,
  record_type,payload,kafka_partition,kafka_offset
) VALUES (
  'cdc25_on','medusa-reference','cdc25_epoch','cdc25_fact','cdc25_order',
  'TRANSITION',
  '{"cart_id":"cdc25_cart","active":true,"observed_state_at":"2026-10-30T00:00:00Z"}'::jsonb,
  0,1
);
UPDATE reference_cdc_v2_order_current_state
SET last_record_id='cdc25_on',last_topic_offset=1
WHERE coverage_epoch_id='cdc25_epoch' AND order_id='cdc25_order';
DO $$ BEGIN
  IF (SELECT count(*) FROM reference_cdc_v2_funnel_terminal_candidate
      WHERE coverage_epoch_id='cdc25_epoch' AND journey_id='cdc25_journey'
        AND checkout_event_id='cdc25_checkout') <> 1
  THEN RAISE EXCEPTION 'ON failed to bind a strong checkout journey'; END IF;
END $$;

INSERT INTO reference_cdc_v2_record_inbox (
  record_id,source_instance_id,coverage_epoch_id,fact_topic,order_id,
  record_type,payload,kafka_partition,kafka_offset
) VALUES (
  'cdc25_off','medusa-reference','cdc25_epoch','cdc25_fact','cdc25_order',
  'TRANSITION','{"cart_id":"cdc25_cart","active":false}'::jsonb,0,2
);
UPDATE reference_cdc_v2_order_current_state
SET active=false,last_record_id='cdc25_off',last_topic_offset=2
WHERE coverage_epoch_id='cdc25_epoch' AND order_id='cdc25_order';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM reference_cdc_v2_funnel_terminal_candidate
             WHERE coverage_epoch_id='cdc25_epoch')
  THEN RAISE EXCEPTION 'OFF failed to retract terminal'; END IF;
END $$;

INSERT INTO reference_cdc_v2_record_inbox (
  record_id,source_instance_id,coverage_epoch_id,fact_topic,order_id,
  record_type,payload,kafka_partition,kafka_offset
) VALUES (
  'cdc25_on_again','medusa-reference','cdc25_epoch','cdc25_fact','cdc25_order',
  'TRANSITION',
  '{"cart_id":"cdc25_cart","active":true,"observed_state_at":"2026-10-30T00:01:00Z"}'::jsonb,
  0,3
);
UPDATE reference_cdc_v2_order_current_state
SET active=true,last_record_id='cdc25_on_again',last_topic_offset=3
WHERE coverage_epoch_id='cdc25_epoch' AND order_id='cdc25_order';
DO $$ BEGIN
  IF (SELECT count(*) FROM reference_cdc_v2_funnel_terminal_candidate
      WHERE coverage_epoch_id='cdc25_epoch' AND on_record_id='cdc25_on_again') <> 1
  THEN RAISE EXCEPTION 're-entry did not use latest ON'; END IF;
END $$;
UPDATE reference_cdc_v2_quality_state
SET verified_at=clock_timestamp()-interval '1 second',
    valid_until=clock_timestamp()+interval '20 milliseconds'
WHERE coverage_epoch_id='cdc25_epoch';
SELECT pg_sleep(0.1);
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM reference_cdc_v2_funnel_terminal_candidate
             WHERE coverage_epoch_id='cdc25_epoch')
  THEN RAISE EXCEPTION 'expired quality lease exposed terminal'; END IF;
END $$;

ROLLBACK;
