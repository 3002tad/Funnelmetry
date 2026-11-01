-- Reference-only DB-GPT exposure. Run as the Pipeline DB owner after CDC setup.
-- The caller provisions funnelmetry_ai_agent separately with a secret and no write grants.
BEGIN;
CREATE SCHEMA IF NOT EXISTS funnelmetry_ai;

CREATE OR REPLACE VIEW funnelmetry_ai.current_products AS
SELECT source_id, product_id, title, source_updated_at::timestamptz AS source_updated_at, observed_at, provider
FROM public.current_product_reference_names_cdc;

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

CREATE OR REPLACE VIEW funnelmetry_ai.current_product_summary AS
SELECT q.source_id, q.status, q.coverage_epoch_id, q.verified_at, q.valid_until,
  CASE WHEN q.status = 'REFERENCE_CURRENT_ONLY' THEN
    (SELECT count(*) FROM funnelmetry_ai.current_products p WHERE p.source_id=q.source_id)
  ELSE NULL END AS product_count
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
  funnelmetry_ai.current_product_summary, funnelmetry_ai.reference_offer_metadata
  TO funnelmetry_ai_agent;
COMMIT;
