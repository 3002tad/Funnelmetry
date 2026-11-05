SET ROLE funnelmetry_ai_agent;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_explore.cart_lines WHERE quantity=2 AND quality_status='UNVERIFIED') THEN RAISE EXCEPTION 'cart exploration failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_explore.order_recorded_state WHERE source_quality_status='CURRENT_STATE_READY' AND quality_status='UNVERIFIED' AND historical_gap_status='INCOMPLETE') THEN RAISE EXCEPTION 'order quality not preserved'; END IF;
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_explore.order_reference_coverage WHERE current_state_status='CURRENT_STATE_READY' AND historical_gap_status='INCOMPLETE' AND gap_start='UNKNOWN' AND gap_end='UNKNOWN' AND baseline_complete_received_at IS NOT NULL AND profile_state='ACTIVE') THEN RAISE EXCEPTION 'coverage evidence missing'; END IF;
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_explore.behavior_events WHERE query_normalized='hat' AND quality_status='UNVERIFIED') THEN RAISE EXCEPTION 'behavior exploration failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_explore.inventory_price_context WHERE stocked_quantity_raw='10' AND quality_status='UNVERIFIED') THEN RAISE EXCEPTION 'inventory context failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_explore.catalog_products WHERE quality_status='UNVERIFIED' AND source_quality_status='REFERENCE_CURRENT_ONLY' AND source_quality_valid_until>now()) THEN RAISE EXCEPTION 'catalog source lease not exposed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_explore.inventory_price_context WHERE quality_status='UNVERIFIED' AND source_quality_status='REFERENCE_CURRENT_ONLY') THEN RAISE EXCEPTION 'inventory source lease not exposed'; END IF;
  IF has_table_privilege(current_user,'public.canonical_events','SELECT') THEN RAISE EXCEPTION 'source table accessible'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='funnelmetry_explore' AND table_name='behavior_events' AND column_name='identity') THEN RAISE EXCEPTION 'unexpected identity exposure'; END IF;
END $$;
RESET ROLE;
UPDATE public.catalog_cdc_quality_lease SET valid_until=now()-interval '1 second';
UPDATE public.inventory_price_cdc_quality_lease SET coverage_epoch_id='different';
UPDATE public.reference_cdc_v2_quality_state SET valid_until=now()-interval '1 second';
SET ROLE funnelmetry_ai_agent;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_explore.catalog_products WHERE source_quality_status='BLOCKED_BY_QUALITY') THEN RAISE EXCEPTION 'expired source lease accepted'; END IF;
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_explore.inventory_price_context WHERE source_quality_status='UNVERIFIED') THEN RAISE EXCEPTION 'different epoch matched'; END IF;
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_explore.order_reference_coverage WHERE current_state_status='BLOCKED_BY_QUALITY' AND historical_gap_status='INCOMPLETE') THEN RAISE EXCEPTION 'expired order lease accepted'; END IF;
END $$;
RESET ROLE;
