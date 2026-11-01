-- Reference-only DB-GPT exposure. Run as the Pipeline DB owner after CDC setup.
-- The caller provisions funnelmetry_ai_agent separately with a secret and no write grants.
BEGIN;
CREATE SCHEMA IF NOT EXISTS funnelmetry_ai;

-- A zero count must not silently mean no products when the lease is missing/stale.
CREATE OR REPLACE VIEW funnelmetry_ai.catalog_quality AS
SELECT s.source_id,
  CASE WHEN b.state = 'ACTIVE' AND q.status = 'PASS'
    AND q.snapshot_complete AND q.valid_until > clock_timestamp()
    AND q.verified_at <= clock_timestamp()
    AND q.source_row_counts = q.projection_row_counts
    AND q.source_digest IS NOT NULL AND q.source_digest = q.projection_digest
    AND q.topic_end_offsets = q.applied_offsets
    AND q.slot_status IN ('reserved','extended') AND q.connector_running
    THEN 'REFERENCE_CURRENT_ONLY' ELSE 'BLOCKED_BY_QUALITY' END AS status,
  q.coverage_epoch_id, q.verified_at, q.valid_until
FROM (VALUES ('medusa-reference'::text)) AS s(source_id)
LEFT JOIN public.catalog_cdc_binding b ON b.source_id = s.source_id
LEFT JOIN public.catalog_cdc_quality_lease q
  ON q.source_id = b.source_id AND q.coverage_epoch_id = b.coverage_epoch_id;

-- A set-returning function enforces the lease before yielding even an empty
-- set, so COUNT(*) cannot turn blocked quality into a zero result.
CREATE OR REPLACE FUNCTION funnelmetry_ai.guarded_current_products()
RETURNS TABLE (source_id text, product_id text, title text,
  source_updated_at timestamptz, observed_at timestamptz, provider text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_ai.catalog_quality q
                 WHERE q.source_id = 'medusa-reference'
                   AND q.status = 'REFERENCE_CURRENT_ONLY') THEN
    RAISE EXCEPTION 'BLOCKED_BY_QUALITY: product catalog is unavailable; do not infer zero or treat unverified data as confirmed'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN QUERY SELECT p.source_id, p.product_id, p.title,
    p.source_updated_at::timestamptz, p.observed_at, p.provider
    FROM public.current_product_reference_names_cdc p
    WHERE p.source_id = 'medusa-reference';
END;
$$;
REVOKE ALL ON FUNCTION funnelmetry_ai.guarded_current_products() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION funnelmetry_ai.guarded_current_products() TO funnelmetry_ai_agent;

CREATE OR REPLACE VIEW funnelmetry_ai.current_products AS
SELECT * FROM funnelmetry_ai.guarded_current_products();

-- Catalog projections share the same snapshot/lease as current_products.
CREATE OR REPLACE FUNCTION funnelmetry_ai.guarded_catalog_variants()
RETURNS TABLE (source_id text, product_id text, variant_id text, title text,
  sku text, manage_inventory boolean, allow_backorder boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_ai.catalog_quality q
    WHERE q.source_id='medusa-reference' AND q.status='REFERENCE_CURRENT_ONLY') THEN
    RAISE EXCEPTION 'BLOCKED_BY_QUALITY: catalog is unavailable; do not treat unverified data as confirmed' USING ERRCODE='P0001';
  END IF;
  RETURN QUERY SELECT v.source_id,v.product_id,v.variant_id,v.title,v.sku,
    v.manage_inventory,v.allow_backorder
    FROM public.catalog_cdc_variants_current v
    JOIN public.catalog_cdc_binding b ON b.source_id=v.source_id AND b.coverage_epoch_id=v.coverage_epoch_id
    JOIN public.catalog_cdc_products_current p ON p.source_id=v.source_id AND p.coverage_epoch_id=v.coverage_epoch_id AND p.product_id=v.product_id
    WHERE b.source_id='medusa-reference' AND b.state='ACTIVE' AND NOT v.soft_deleted AND NOT p.soft_deleted;
END; $$;

CREATE OR REPLACE FUNCTION funnelmetry_ai.guarded_catalog_categories()
RETURNS TABLE (source_id text, category_id text, name text, parent_category_id text,
  is_active boolean, is_internal boolean)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_ai.catalog_quality q
    WHERE q.source_id='medusa-reference' AND q.status='REFERENCE_CURRENT_ONLY') THEN
    RAISE EXCEPTION 'BLOCKED_BY_QUALITY: catalog is unavailable; do not treat unverified data as confirmed' USING ERRCODE='P0001';
  END IF;
  RETURN QUERY SELECT c.source_id,c.category_id,c.name,c.parent_category_id,c.is_active,c.is_internal
    FROM public.catalog_cdc_categories_current c
    JOIN public.catalog_cdc_binding b ON b.source_id=c.source_id AND b.coverage_epoch_id=c.coverage_epoch_id
    WHERE b.source_id='medusa-reference' AND b.state='ACTIVE' AND NOT c.soft_deleted;
END; $$;

CREATE OR REPLACE FUNCTION funnelmetry_ai.guarded_product_categories()
RETURNS TABLE (source_id text, product_id text, category_id text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM funnelmetry_ai.catalog_quality q
    WHERE q.source_id='medusa-reference' AND q.status='REFERENCE_CURRENT_ONLY') THEN
    RAISE EXCEPTION 'BLOCKED_BY_QUALITY: catalog is unavailable; do not treat unverified data as confirmed' USING ERRCODE='P0001';
  END IF;
  RETURN QUERY SELECT r.source_id,r.product_id,r.category_id
    FROM public.catalog_cdc_product_categories_current r
    JOIN public.catalog_cdc_binding b ON b.source_id=r.source_id AND b.coverage_epoch_id=r.coverage_epoch_id
    JOIN public.catalog_cdc_products_current p ON p.source_id=r.source_id AND p.coverage_epoch_id=r.coverage_epoch_id AND p.product_id=r.product_id
    JOIN public.catalog_cdc_categories_current c ON c.source_id=r.source_id AND c.coverage_epoch_id=r.coverage_epoch_id AND c.category_id=r.category_id
    WHERE b.source_id='medusa-reference' AND b.state='ACTIVE' AND NOT p.soft_deleted AND NOT c.soft_deleted;
END; $$;

REVOKE ALL ON FUNCTION funnelmetry_ai.guarded_catalog_variants(), funnelmetry_ai.guarded_catalog_categories(), funnelmetry_ai.guarded_product_categories() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION funnelmetry_ai.guarded_catalog_variants(), funnelmetry_ai.guarded_catalog_categories(), funnelmetry_ai.guarded_product_categories() TO funnelmetry_ai_agent;
CREATE OR REPLACE VIEW funnelmetry_ai.current_variants AS SELECT * FROM funnelmetry_ai.guarded_catalog_variants();
CREATE OR REPLACE VIEW funnelmetry_ai.current_categories AS SELECT * FROM funnelmetry_ai.guarded_catalog_categories();
CREATE OR REPLACE VIEW funnelmetry_ai.current_product_categories AS SELECT * FROM funnelmetry_ai.guarded_product_categories();

-- Fail closed even when a client selects only product_count (or COALESCEs it).
-- Kept in the same statement as the quality check and count.
CREATE OR REPLACE FUNCTION funnelmetry_ai.product_count_quality_blocked()
RETURNS bigint LANGUAGE plpgsql VOLATILE AS $$
BEGIN
  RAISE EXCEPTION 'BLOCKED_BY_QUALITY: product count is unavailable; do not infer zero or a change'
    USING ERRCODE = 'P0001';
END;
$$;

CREATE OR REPLACE VIEW funnelmetry_ai.current_product_summary AS
SELECT q.source_id, q.status, q.coverage_epoch_id, q.verified_at, q.valid_until,
  CASE WHEN q.status = 'REFERENCE_CURRENT_ONLY' THEN
    (SELECT count(*) FROM funnelmetry_ai.current_products p WHERE p.source_id=q.source_id)
  ELSE funnelmetry_ai.product_count_quality_blocked() END AS product_count
FROM funnelmetry_ai.catalog_quality q;

-- Expose only the explicitly active, published release; no physical tables or secrets.
CREATE OR REPLACE VIEW funnelmetry_ai.reference_offer_metadata AS
SELECT r.asset_id, r.asset_version, r.contract_id, r.definition, r.published_at,
  b.source_id, b.state AS binding_state, b.catalog_epoch_id, b.stage2_epoch_id
FROM public.reference_current_offer_metadata_releases r
JOIN public.reference_current_offer_metadata_bindings b
  ON b.asset_id=r.asset_id AND b.asset_version=r.asset_version
WHERE b.source_id='medusa-reference' AND b.state='ACTIVE'
  AND r.asset_id='asset.reference_medusa_current_offer'
  AND r.asset_version='1.0.0' AND r.contract_id='reference.medusa.current_offer.v1';

GRANT USAGE ON SCHEMA funnelmetry_ai TO funnelmetry_ai_agent;
GRANT SELECT ON funnelmetry_ai.current_products, funnelmetry_ai.catalog_quality,
  funnelmetry_ai.current_variants, funnelmetry_ai.current_categories, funnelmetry_ai.current_product_categories,
  funnelmetry_ai.current_product_summary, funnelmetry_ai.reference_offer_metadata
  TO funnelmetry_ai_agent;
COMMIT;
