-- DEC-150 demo exploratory binding. Execute as the Pipeline database owner.
-- Browser behavior may span synthetic and observed sources. All other demo
-- tables are synthetic-only; CDC current-state views remain independently available.
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'funnelmetry_handoff' THEN
    RAISE EXCEPTION 'wrong database: expected funnelmetry_handoff';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM demo_history.seed_manifest
    WHERE dataset_id = 'demo-historical-100000-v2'
      AND fixture_sha256 = '5858034aa55353d166fb9c2eaeb21f84f0d966d96e79a69b78e6bc2041544e0b'
      AND logical_sha256 = '074d25c357a598767e58175bd0b0b2932118b4f6461fdb85d99a50cdcd2b3230'
  ) THEN RAISE EXCEPTION 'approved demo seed missing'; END IF;
  IF to_regrole('funnelmetry_ai_agent') IS NULL THEN RAISE EXCEPTION 'AI role missing'; END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='funnelmetry_demo')
     AND to_regclass('funnelmetry_demo.binding_version') IS NULL THEN
    RAISE EXCEPTION 'funnelmetry_demo schema exists without ownership marker';
  END IF;
END $guard$;
SELECT pg_advisory_xact_lock(hashtextextended('funnelmetry-demo-binding-v1',0));
CREATE SCHEMA IF NOT EXISTS funnelmetry_demo;
REVOKE ALL ON SCHEMA funnelmetry_demo FROM PUBLIC;
CREATE TABLE IF NOT EXISTS funnelmetry_demo.binding_version (
  version text PRIMARY KEY CHECK (version='demo-analytical-views-v1'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO funnelmetry_demo.binding_version(version) VALUES ('demo-analytical-views-v1') ON CONFLICT DO NOTHING;

-- Each view inherits its source table's declared domain grain. It adds explicit
-- source, scope and quality; it does not certify observed-source coverage.
DO $views$
DECLARE name text;
BEGIN
  FOREACH name IN ARRAY ARRAY['catalog_products','catalog_variants','catalog_categories',
    'product_categories','category_history','crosswalk','coverage','offer_prices',
    'stock_positions','sessions','browser_events','cart_changes','cart_links','orders',
    'order_transitions','order_lines','payments','fulfillments','customer_evidence'] LOOP
    EXECUTE format('CREATE OR REPLACE VIEW funnelmetry_demo.%I AS SELECT t.*, ''synthetic_history''::text AS analytical_source_id, ''UNVERIFIED''::text AS analytical_quality FROM demo_history.%I t WHERE dataset_id = ''demo-historical-100000-v2''', name, name);
    EXECUTE format('COMMENT ON VIEW funnelmetry_demo.%I IS %L', name,
      'Synthetic demo fixture only. Historical values are generated, not Medusa historical facts; preserve dataset_id, origin, analytical_quality and domain grain.');
    EXECUTE format('GRANT SELECT ON funnelmetry_demo.%I TO funnelmetry_ai_agent', name);
  END LOOP;
END $views$;

-- Synthetic events end at the exclusive range boundary from their approved
-- manifest. Observed rows after that boundary remain individually UNVERIFIED;
-- the time filter is NOT a claim of uninterrupted observed coverage.
CREATE OR REPLACE VIEW funnelmetry_demo.behavior_events_all AS
SELECT e.dataset_id, e.origin, 'synthetic_history'::text AS source_id,
       e.event_id, e.event_type, e.occurred_at, e.loaded_at AS ingested_at,
       CASE WHEN e.event_type='behavior.search_query_submitted' THEN e.data->>'query_normalized' END AS query_normalized,
       'UNVERIFIED'::text AS quality_status,
       'synthetic fixture; no observed coverage claim'::text AS coverage_note
FROM demo_history.browser_events e
WHERE e.dataset_id='demo-historical-100000-v2'
UNION ALL
SELECT 'demo-historical-100000-v2'::text, 'OBSERVED_SOURCE'::text, e.source_id,
       e.canonical_event_id, e.event_type, e.occurred_at, e.ingested_at,
       e.query_normalized, e.quality_status,
       'observed event; source coverage may be incomplete'::text
FROM funnelmetry_explore.behavior_events e
WHERE e.occurred_at >= '2026-11-01T00:00:00Z'::timestamptz
  AND e.event_type IN ('behavior.page_viewed','behavior.product_viewed',
    'behavior.scroll_depth_reached','behavior.search_query_submitted',
    'checkout.started','context.cart_linked');
COMMENT ON VIEW funnelmetry_demo.behavior_events_all IS
  'Event grain, UTC occurred_at. Synthetic before 2026-11-01; observed rows from boundary onward. Observed coverage and gap are not certified; NULL/missing days are not zero. No session/cart identity join or search-to-cart attribution is implied.';
GRANT USAGE ON SCHEMA funnelmetry_demo TO funnelmetry_ai_agent;
GRANT SELECT ON funnelmetry_demo.behavior_events_all TO funnelmetry_ai_agent;
COMMIT;
