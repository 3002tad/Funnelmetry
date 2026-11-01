-- Reference exploratory access. Run as the Pipeline database owner.
-- These views do not publish metrics or assert source completeness.
BEGIN;
CREATE SCHEMA IF NOT EXISTS funnelmetry_explore;

CREATE OR REPLACE VIEW funnelmetry_explore.catalog_products AS
SELECT source_id, coverage_epoch_id, product_id, title, handle, status,
       collection_id, source_updated_raw, soft_deleted, 'UNVERIFIED'::text AS quality_status
FROM public.catalog_cdc_products_current;

CREATE OR REPLACE VIEW funnelmetry_explore.catalog_variants AS
SELECT source_id, coverage_epoch_id, variant_id, product_id, title, sku,
       manage_inventory, allow_backorder, source_updated_raw, soft_deleted,
       'UNVERIFIED'::text AS quality_status
FROM public.catalog_cdc_variants_current;

CREATE OR REPLACE VIEW funnelmetry_explore.catalog_categories AS
SELECT source_id, coverage_epoch_id, category_id, name, parent_category_id,
       is_active, is_internal, soft_deleted, 'UNVERIFIED'::text AS quality_status
FROM public.catalog_cdc_categories_current;

CREATE OR REPLACE VIEW funnelmetry_explore.catalog_product_categories AS
SELECT source_id, coverage_epoch_id, product_id, category_id,
       'UNVERIFIED'::text AS quality_status
FROM public.catalog_cdc_product_categories_current;

CREATE OR REPLACE VIEW funnelmetry_explore.cart_lines AS
SELECT source_id, coverage_epoch_id, line_item_id, cart_id, product_id,
       variant_id, quantity, deleted, source_updated_raw,
       'UNVERIFIED'::text AS quality_status
FROM public.cart_cdc_line_state;

CREATE OR REPLACE VIEW funnelmetry_explore.order_recorded_state AS
SELECT s.source_instance_id, s.coverage_epoch_id, s.order_id, s.cart_id,
       s.active, s.updated_at, q.status AS source_quality_status,
       q.verified_at, q.valid_until, q.historical_gap_status,
       'UNVERIFIED'::text AS quality_status
FROM public.reference_cdc_v2_order_current_state s
LEFT JOIN public.reference_cdc_v2_quality_state q
  ON q.source_instance_id=s.source_instance_id AND q.coverage_epoch_id=s.coverage_epoch_id;

CREATE OR REPLACE VIEW funnelmetry_explore.behavior_events AS
SELECT canonical_event_id, source_id, event_type, event_class, occurred_at,
       ingested_at, canonical_schema_version, mapping_version,
       CASE WHEN event_type='behavior.search_query_submitted'
         THEN data->>'query_normalized' ELSE NULL END AS query_normalized,
       'UNVERIFIED'::text AS quality_status
FROM public.canonical_events;

CREATE OR REPLACE VIEW funnelmetry_explore.funnel_instances AS
SELECT source_id, funnel_instance_id, journey_id, funnel_profile_id,
       profile_version, entry_at, outcome_status, quality_status,
       reached_step_count, total_step_count, projected_at,
       'UNVERIFIED'::text AS exploration_status
FROM public.funnel_kpi_instance_facts;

CREATE OR REPLACE VIEW funnelmetry_explore.funnel_steps AS
SELECT f.source_id, f.funnel_instance_id, f.funnel_profile_id, f.profile_version,
       s.step_index, s.step_id, s.event_type, s.first_reached_at,
       s.last_reached_at, s.occurrence_count, f.quality_status,
       'UNVERIFIED'::text AS exploration_status
FROM public.funnel_kpi_instance_facts f
JOIN public.funnel_kpi_step_facts s ON s.funnel_instance_id=f.funnel_instance_id;

-- The CDC writer already constrains these rows, and the view selects only
-- fields useful for investigation. Values remain source context, not resolved
-- customer prices or sellable inventory.
CREATE OR REPLACE VIEW funnelmetry_explore.inventory_price_context AS
SELECT source_id, coverage_epoch_id, table_name, row_key, soft_deleted,
       observed_at, payload->>'id' AS source_row_id,
       payload->>'inventory_item_id' AS inventory_item_id,
       payload->>'location_id' AS location_id,
       payload->>'stocked_quantity' AS stocked_quantity_raw,
       payload->>'reserved_quantity' AS reserved_quantity_raw,
       payload->>'variant_id' AS variant_id,
       payload->>'price_set_id' AS price_set_id,
       payload->>'currency_code' AS currency_code,
       payload->>'amount' AS amount_raw,
       'UNVERIFIED'::text AS quality_status
FROM public.inventory_price_cdc_context_current
WHERE table_name IN ('inventory_level','product_variant_price_set','price');

COMMENT ON SCHEMA funnelmetry_explore IS 'Exploratory projections only; UNVERIFIED is not an official quality or metric certificate.';
COMMENT ON VIEW funnelmetry_explore.catalog_products IS 'Source x coverage epoch x product; includes soft-deleted records. Join other catalog views on source, epoch and product ID.';
COMMENT ON VIEW funnelmetry_explore.catalog_variants IS 'Source x coverage epoch x variant. Multiple variants per product; avoid join fanout when counting products.';
COMMENT ON VIEW funnelmetry_explore.catalog_categories IS 'Source x coverage epoch x category; includes soft-deleted records.';
COMMENT ON VIEW funnelmetry_explore.catalog_product_categories IS 'Source x epoch x product x category; many-to-many relationships can multiply rows.';
COMMENT ON VIEW funnelmetry_explore.cart_lines IS 'Source x epoch x line item current state, including deleted records; this is not a history of additions.';
COMMENT ON VIEW funnelmetry_explore.order_recorded_state IS 'Source x epoch x order current state. Active is reference recorded state, not paid, completed, conversion or revenue. Historical coverage can be incomplete.';
COMMENT ON VIEW funnelmetry_explore.behavior_events IS 'Canonical event rows with selected fields; no raw identity or full payload. Search text may be sensitive. Events are not sessions or journeys.';
COMMENT ON VIEW funnelmetry_explore.funnel_instances IS 'One row per funnel instance and version; quality_status is the projection status, exploration_status remains UNVERIFIED.';
COMMENT ON VIEW funnelmetry_explore.funnel_steps IS 'One row per reached step per funnel instance; joining to instances creates fanout. Missing rows do not prove the step was not taken.';
COMMENT ON VIEW funnelmetry_explore.inventory_price_context IS 'Selected raw CDC context only; amount is not resolved customer price and stock rows are not sellable inventory. Context validity, rules and location must be checked separately.';

GRANT USAGE ON SCHEMA funnelmetry_explore TO funnelmetry_ai_agent;
GRANT SELECT ON funnelmetry_explore.cart_lines,
  funnelmetry_explore.catalog_products, funnelmetry_explore.catalog_variants,
  funnelmetry_explore.catalog_categories, funnelmetry_explore.catalog_product_categories,
  funnelmetry_explore.order_recorded_state, funnelmetry_explore.behavior_events,
  funnelmetry_explore.funnel_instances, funnelmetry_explore.funnel_steps,
  funnelmetry_explore.inventory_price_context TO funnelmetry_ai_agent;
COMMIT;
