-- Run only after test-fixture.sql and analytical-views.sql on an isolated DB.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_ai.current_product_summary
    WHERE status='REFERENCE_CURRENT_ONLY' AND product_count=2) THEN
    RAISE EXCEPTION 'fresh quality lease did not expose product count';
  END IF;
  IF (SELECT count(*) FROM funnelmetry_ai.reference_offer_metadata) <> 1 THEN
    RAISE EXCEPTION 'active metadata release not visible';
  END IF;
  IF (SELECT count(*) FROM funnelmetry_ai.current_variants) <> 1 OR
     (SELECT count(*) FROM funnelmetry_ai.current_categories) <> 1 OR
     (SELECT count(*) FROM funnelmetry_ai.current_product_categories) <> 1 THEN
    RAISE EXCEPTION 'catalog relationships are not visible';
  END IF;
END $$;
UPDATE public.catalog_cdc_quality_lease SET valid_until=now()-interval '1 second';
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_ai.catalog_quality
    WHERE status='BLOCKED_BY_QUALITY') THEN
    RAISE EXCEPTION 'expired quality lease must expose blocked status';
  END IF;
  BEGIN
    PERFORM product_count FROM funnelmetry_ai.current_product_summary;
    RAISE EXCEPTION 'blocked count must fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'BLOCKED_BY_QUALITY:%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM count(*) FROM funnelmetry_ai.current_products;
    RAISE EXCEPTION 'blocked products count must fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'BLOCKED_BY_QUALITY:%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM count(*) FROM funnelmetry_ai.current_variants;
    RAISE EXCEPTION 'blocked variants count must fail';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'BLOCKED_BY_QUALITY:%' THEN RAISE; END IF;
  END;
  BEGIN
    PERFORM coalesce(product_count, 0) FROM funnelmetry_ai.current_product_summary;
    RAISE EXCEPTION 'coalesce must not turn blocked count into zero';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE 'BLOCKED_BY_QUALITY:%' THEN RAISE; END IF;
  END;
END $$;
SET ROLE funnelmetry_ai_agent;
DO $$ BEGIN
  BEGIN
    PERFORM count(*) FROM public.catalog_cdc_products_current;
    RAISE EXCEPTION 'raw table must not be readable';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
END $$;
RESET ROLE;
UPDATE public.reference_current_offer_metadata_bindings SET state='SHADOW';
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM funnelmetry_ai.reference_offer_metadata) THEN
    RAISE EXCEPTION 'non-active metadata binding must not be exposed';
  END IF;
  IF has_table_privilege('funnelmetry_ai_agent', 'funnelmetry_ai.current_products', 'UPDATE') THEN
    RAISE EXCEPTION 'connector role must not have UPDATE privilege';
  END IF;
END $$;
