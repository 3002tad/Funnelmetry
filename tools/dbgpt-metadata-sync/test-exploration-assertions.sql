SET ROLE funnelmetry_ai_agent;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_explore.cart_lines WHERE quantity=2 AND quality_status='UNVERIFIED') THEN RAISE EXCEPTION 'cart exploration failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_explore.order_recorded_state WHERE source_quality_status='BLOCKED_BY_QUALITY' AND quality_status='UNVERIFIED' AND historical_gap_status='INCOMPLETE') THEN RAISE EXCEPTION 'order quality not preserved'; END IF;
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_explore.behavior_events WHERE query_normalized='hat' AND quality_status='UNVERIFIED') THEN RAISE EXCEPTION 'behavior exploration failed'; END IF;
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_explore.inventory_price_context WHERE stocked_quantity_raw='10' AND quality_status='UNVERIFIED') THEN RAISE EXCEPTION 'inventory context failed'; END IF;
  IF has_table_privilege(current_user,'public.canonical_events','SELECT') THEN RAISE EXCEPTION 'source table accessible'; END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='funnelmetry_explore' AND table_name='behavior_events' AND column_name='identity') THEN RAISE EXCEPTION 'unexpected identity exposure'; END IF;
END $$;
RESET ROLE;
