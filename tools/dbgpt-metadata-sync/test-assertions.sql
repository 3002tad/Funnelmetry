-- Run only after test-fixture.sql and analytical-views.sql on an isolated DB.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_ai.current_product_summary
    WHERE status='REFERENCE_CURRENT_ONLY' AND product_count=2) THEN
    RAISE EXCEPTION 'fresh quality lease did not expose product count';
  END IF;
  IF (SELECT count(*) FROM funnelmetry_ai.reference_offer_metadata) <> 1 THEN
    RAISE EXCEPTION 'active metadata release not visible';
  END IF;
END $$;
UPDATE public.catalog_cdc_quality_lease SET valid_until=now()-interval '1 second';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_ai.current_product_summary
    WHERE status='BLOCKED_BY_QUALITY' AND product_count IS NULL) THEN
    RAISE EXCEPTION 'expired quality lease must suppress count';
  END IF;
END $$;
UPDATE public.reference_current_offer_metadata_bindings SET state='SHADOW';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM funnelmetry_ai.reference_offer_metadata) THEN
    RAISE EXCEPTION 'non-active metadata binding must not be exposed';
  END IF;
  IF has_table_privilege('funnelmetry_ai_agent', 'funnelmetry_ai.current_products', 'UPDATE') THEN
    RAISE EXCEPTION 'connector role must not have UPDATE privilege';
  END IF;
END $$;
