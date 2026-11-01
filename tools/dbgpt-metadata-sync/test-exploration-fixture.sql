-- Disposable PostgreSQL only: minimal source schema for exploration views.
CREATE ROLE funnelmetry_ai_agent;
CREATE TABLE public.catalog_cdc_products_current(source_id text, coverage_epoch_id text, product_id text, title text, handle text, status text, collection_id text, source_updated_raw text, soft_deleted boolean);
CREATE TABLE public.catalog_cdc_variants_current(source_id text, coverage_epoch_id text, variant_id text, product_id text, title text, sku text, manage_inventory boolean, allow_backorder boolean, source_updated_raw text, soft_deleted boolean);
CREATE TABLE public.catalog_cdc_categories_current(source_id text, coverage_epoch_id text, category_id text, name text, parent_category_id text, is_active boolean, is_internal boolean, soft_deleted boolean);
CREATE TABLE public.catalog_cdc_product_categories_current(source_id text, coverage_epoch_id text, product_id text, category_id text);
CREATE TABLE public.cart_cdc_line_state(source_id text, coverage_epoch_id text, line_item_id text, cart_id text, product_id text, variant_id text, quantity integer, deleted boolean, source_updated_raw text);
CREATE TABLE public.reference_cdc_v2_order_current_state(source_instance_id text, coverage_epoch_id text, order_id text, cart_id text, active boolean, updated_at timestamptz);
CREATE TABLE public.reference_cdc_v2_quality_state(source_instance_id text, coverage_epoch_id text, status text, verified_at timestamptz, valid_until timestamptz, historical_gap_status text);
CREATE TABLE public.canonical_events(canonical_event_id text, source_id text, event_type text, event_class text, occurred_at timestamptz, ingested_at timestamptz, canonical_schema_version text, mapping_version text, data jsonb, identity jsonb);
CREATE TABLE public.funnel_kpi_instance_facts(source_id text, funnel_instance_id text, journey_id text, funnel_profile_id text, profile_version text, entry_at timestamptz, outcome_status text, quality_status text, reached_step_count int, total_step_count int, projected_at timestamptz);
CREATE TABLE public.funnel_kpi_step_facts(funnel_instance_id text, step_index int, step_id text, event_type text, first_reached_at timestamptz, last_reached_at timestamptz, occurrence_count int);
CREATE TABLE public.inventory_price_cdc_context_current(source_id text, coverage_epoch_id text, table_name text, row_key jsonb, soft_deleted boolean, observed_at timestamptz, payload jsonb);
INSERT INTO public.cart_cdc_line_state VALUES ('s','e','l','c','p','v',2,false,'2026-01-01');
INSERT INTO public.reference_cdc_v2_order_current_state VALUES ('s','e','o','c',true,now());
INSERT INTO public.reference_cdc_v2_quality_state VALUES ('s','e','BLOCKED_BY_QUALITY',now(),now(),'INCOMPLETE');
INSERT INTO public.canonical_events VALUES ('id','s','behavior.search_query_submitted','BEHAVIOR_INTENT',now(),now(),'v1','v1','{"query_normalized":"hat"}','{"email":"private@example.test"}');
INSERT INTO public.inventory_price_cdc_context_current VALUES ('s','e','inventory_level','[]',false,now(),'{"stocked_quantity":"10","private":"secret"}');
