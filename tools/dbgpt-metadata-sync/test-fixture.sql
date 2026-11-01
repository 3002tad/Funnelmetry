-- Isolated PostgreSQL fixture; never run against the Pipeline database.
CREATE ROLE funnelmetry_ai_agent;
CREATE TABLE public.catalog_cdc_binding (source_id text, coverage_epoch_id text, state text);
CREATE TABLE public.catalog_cdc_quality_lease (
  source_id text, coverage_epoch_id text, status text, snapshot_complete boolean,
  source_row_counts jsonb, projection_row_counts jsonb, source_digest text,
  projection_digest text, topic_end_offsets jsonb, applied_offsets jsonb,
  slot_status text, connector_running boolean, verified_at timestamptz, valid_until timestamptz
);
CREATE TABLE public.catalog_fixture_products (
  source_id text, product_id text, title text, source_updated_at text,
  observed_at timestamptz, provider text
);
CREATE VIEW public.current_product_reference_names_cdc AS SELECT * FROM public.catalog_fixture_products;
CREATE TABLE public.catalog_cdc_products_current (source_id text, coverage_epoch_id text, product_id text, soft_deleted boolean);
CREATE TABLE public.catalog_cdc_variants_current (source_id text, coverage_epoch_id text, product_id text, variant_id text, title text, sku text, manage_inventory boolean, allow_backorder boolean, soft_deleted boolean);
CREATE TABLE public.catalog_cdc_categories_current (source_id text, coverage_epoch_id text, category_id text, name text, parent_category_id text, is_active boolean, is_internal boolean, soft_deleted boolean);
CREATE TABLE public.catalog_cdc_product_categories_current (source_id text, coverage_epoch_id text, product_id text, category_id text);
CREATE TABLE public.reference_current_offer_metadata_releases (
  asset_id text, asset_version text, contract_id text, definition jsonb, published_at timestamptz
);
CREATE TABLE public.reference_current_offer_metadata_bindings (
  source_id text, asset_id text, asset_version text, state text,
  catalog_epoch_id text, stage2_epoch_id text
);
INSERT INTO public.catalog_cdc_binding VALUES ('medusa-reference','epoch1','ACTIVE');
INSERT INTO public.catalog_cdc_quality_lease VALUES
  ('medusa-reference','epoch1','PASS',true,'{}','{}','a','a','{}','{}',
   'reserved',true,now()-interval '1 minute',now()+interval '5 minutes');
INSERT INTO public.catalog_fixture_products VALUES
  ('medusa-reference','p1','Product 1','2026-01-01T00:00:00Z',now(),'test'),
  ('medusa-reference','p2','Product 2','2026-01-01T00:00:00Z',now(),'test');
INSERT INTO public.catalog_cdc_products_current VALUES ('medusa-reference','epoch1','p1',false),('medusa-reference','epoch1','p2',false);
INSERT INTO public.catalog_cdc_variants_current VALUES ('medusa-reference','epoch1','p1','v1','Variant 1','sku1',true,false,false);
INSERT INTO public.catalog_cdc_categories_current VALUES ('medusa-reference','epoch1','c1','Category 1',NULL,true,false,false);
INSERT INTO public.catalog_cdc_product_categories_current VALUES ('medusa-reference','epoch1','p1','c1');
INSERT INTO public.reference_current_offer_metadata_releases VALUES
  ('asset.reference_medusa_current_offer','1.0.0','reference.medusa.current_offer.v1','{}',now());
INSERT INTO public.reference_current_offer_metadata_bindings VALUES
  ('medusa-reference','asset.reference_medusa_current_offer','1.0.0','ACTIVE','epoch1','epoch2');
