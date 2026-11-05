-- Synthetic continuation in the existing DEC-150 demo database.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('funnelmetry-demo-history-v1',0));
DO $guard$
BEGIN
 IF current_database() <> 'funnelmetry_handoff' THEN RAISE EXCEPTION 'wrong database'; END IF;
 IF NOT EXISTS (SELECT 1 FROM demo_history.seed_manifest WHERE dataset_id='demo-gap-20261101-20261105-v1'
   AND manifest_sha256='09a559d8fe7cdf051c3260e6a29370eab849cd910c265478f5ed3129f897ca30'
   AND fixture_sha256='6089a21874defb09b7641166481b8261e4313604f700686fbe3a23d9f4a41bd8') THEN
   RAISE EXCEPTION 'gap fixture missing or changed';
 END IF;
 IF EXISTS (SELECT 1 FROM funnelmetry_explore.behavior_events WHERE occurred_at >= '2026-11-01T00:00:00Z'
   AND occurred_at < '2026-11-05T00:00:00Z') THEN RAISE EXCEPTION 'observed events overlap synthetic gap'; END IF;
END $guard$;

-- dataset_id remains part of every entity key: catalog snapshots repeat across
-- segments and must be joined with dataset_id to avoid multiplying facts.
DO $views$
DECLARE name text;
BEGIN
 FOREACH name IN ARRAY ARRAY['catalog_products','catalog_variants','catalog_categories',
  'product_categories','category_history','crosswalk','coverage','offer_prices',
  'stock_positions','sessions','browser_events','cart_changes','cart_links','orders',
  'order_transitions','order_lines','payments','fulfillments','customer_evidence'] LOOP
  EXECUTE format('CREATE OR REPLACE VIEW funnelmetry_demo.%I AS SELECT t.*, ''synthetic_history''::text AS analytical_source_id, ''UNVERIFIED''::text AS analytical_quality FROM demo_history.%I t WHERE dataset_id IN (''demo-historical-100000-v2'',''demo-gap-20261101-20261105-v1'')', name, name);
 END LOOP;
END $views$;
CREATE OR REPLACE VIEW funnelmetry_demo.behavior_events_all AS
SELECT e.dataset_id,e.origin,'synthetic_history'::text AS source_id,e.event_id,e.event_type,e.occurred_at,e.loaded_at AS ingested_at,
  CASE WHEN e.event_type='behavior.search_query_submitted' THEN e.data->>'query_normalized' END AS query_normalized,
  'UNVERIFIED'::text AS quality_status,'synthetic fixture; no observed coverage claim'::text AS coverage_note
FROM demo_history.browser_events e WHERE e.dataset_id IN ('demo-historical-100000-v2','demo-gap-20261101-20261105-v1')
UNION ALL
SELECT 'demo-historical-100000-v2'::text,'OBSERVED_SOURCE'::text,e.source_id,e.canonical_event_id,e.event_type,e.occurred_at,e.ingested_at,
  e.query_normalized,e.quality_status,'observed event; source coverage may be incomplete'::text
FROM funnelmetry_explore.behavior_events e WHERE e.occurred_at >= '2026-11-05T00:00:00Z'::timestamptz
 AND e.event_type IN ('behavior.page_viewed','behavior.product_viewed','behavior.scroll_depth_reached',
  'behavior.search_query_submitted','checkout.started','context.cart_linked');
COMMENT ON VIEW funnelmetry_demo.behavior_events_all IS 'Synthetic through 2026-11-05 UTC; observed thereafter. Late observed events during synthetic coverage remain accessible through funnelmetry_explore.behavior_events and are counted by gap_overlap_status.';
CREATE OR REPLACE VIEW funnelmetry_demo.gap_overlap_status AS
 SELECT 'demo-gap-20261101-20261105-v1'::text AS dataset_id,
   '2026-11-01T00:00:00Z'::timestamptz AS period_start,'2026-11-05T00:00:00Z'::timestamptz AS period_end,
   count(*) AS observed_overlap_count,
   CASE WHEN count(*)=0 THEN 'NO_OBSERVED_OVERLAP' ELSE 'LATE_OBSERVED_OVERLAP' END::text AS overlap_status
 FROM funnelmetry_explore.behavior_events WHERE occurred_at >= '2026-11-01T00:00:00Z' AND occurred_at < '2026-11-05T00:00:00Z';
GRANT SELECT ON funnelmetry_demo.gap_overlap_status TO funnelmetry_ai_agent;
CREATE OR REPLACE VIEW funnelmetry_demo.gap_dataset_coverage AS
WITH actual AS (
  SELECT 'catalog_products'::text AS domain, count(*) AS n FROM demo_history.catalog_products WHERE dataset_id='demo-gap-20261101-20261105-v1'
  UNION ALL SELECT 'catalog_variants'::text AS domain, count(*) AS n FROM demo_history.catalog_variants WHERE dataset_id='demo-gap-20261101-20261105-v1'
  UNION ALL SELECT 'catalog_categories'::text AS domain, count(*) AS n FROM demo_history.catalog_categories WHERE dataset_id='demo-gap-20261101-20261105-v1'
  UNION ALL SELECT 'product_categories'::text AS domain, count(*) AS n FROM demo_history.product_categories WHERE dataset_id='demo-gap-20261101-20261105-v1'
  UNION ALL SELECT 'category_history'::text AS domain, count(*) AS n FROM demo_history.category_history WHERE dataset_id='demo-gap-20261101-20261105-v1'
  UNION ALL SELECT 'crosswalk'::text AS domain, count(*) AS n FROM demo_history.crosswalk WHERE dataset_id='demo-gap-20261101-20261105-v1'
  UNION ALL SELECT 'coverage'::text AS domain, count(*) AS n FROM demo_history.coverage WHERE dataset_id='demo-gap-20261101-20261105-v1'
  UNION ALL SELECT 'offer_prices'::text AS domain, count(*) AS n FROM demo_history.offer_prices WHERE dataset_id='demo-gap-20261101-20261105-v1'
  UNION ALL SELECT 'stock_positions'::text AS domain, count(*) AS n FROM demo_history.stock_positions WHERE dataset_id='demo-gap-20261101-20261105-v1'
  UNION ALL SELECT 'sessions'::text AS domain, count(*) AS n FROM demo_history.sessions WHERE dataset_id='demo-gap-20261101-20261105-v1'
  UNION ALL SELECT 'browser_events'::text AS domain, count(*) AS n FROM demo_history.browser_events WHERE dataset_id='demo-gap-20261101-20261105-v1'
  UNION ALL SELECT 'cart_changes'::text AS domain, count(*) AS n FROM demo_history.cart_changes WHERE dataset_id='demo-gap-20261101-20261105-v1'
  UNION ALL SELECT 'cart_links'::text AS domain, count(*) AS n FROM demo_history.cart_links WHERE dataset_id='demo-gap-20261101-20261105-v1'
  UNION ALL SELECT 'orders'::text AS domain, count(*) AS n FROM demo_history.orders WHERE dataset_id='demo-gap-20261101-20261105-v1'
  UNION ALL SELECT 'order_transitions'::text AS domain, count(*) AS n FROM demo_history.order_transitions WHERE dataset_id='demo-gap-20261101-20261105-v1'
  UNION ALL SELECT 'order_lines'::text AS domain, count(*) AS n FROM demo_history.order_lines WHERE dataset_id='demo-gap-20261101-20261105-v1'
  UNION ALL SELECT 'payments'::text AS domain, count(*) AS n FROM demo_history.payments WHERE dataset_id='demo-gap-20261101-20261105-v1'
  UNION ALL SELECT 'fulfillments'::text AS domain, count(*) AS n FROM demo_history.fulfillments WHERE dataset_id='demo-gap-20261101-20261105-v1'
  UNION ALL SELECT 'customer_evidence'::text AS domain, count(*) AS n FROM demo_history.customer_evidence WHERE dataset_id='demo-gap-20261101-20261105-v1'
), checks AS (
 SELECT m.dataset_id,m.fixture_sha256,m.loaded_at,
   (SELECT count(*) FROM actual WHERE n <> COALESCE((m.manifest->'counts'->>domain)::bigint,-1)) AS mismatched_domains,
   (SELECT count(*) FROM demo_history.sessions s WHERE s.dataset_id=m.dataset_id AND
    (s.started_at < '2026-11-01T00:00:00Z' OR s.started_at >= '2026-11-05T00:00:00Z')) AS invalid_sessions
 FROM demo_history.seed_manifest m WHERE m.dataset_id='demo-gap-20261101-20261105-v1'
)
SELECT *,CASE WHEN mismatched_domains=0 AND invalid_sessions=0 THEN 'READY_FOR_DEMO' ELSE 'DEMO_DATA_MISMATCH' END::text AS demo_status
FROM checks;
GRANT SELECT ON funnelmetry_demo.gap_dataset_coverage TO funnelmetry_ai_agent;
COMMIT;
