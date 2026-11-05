-- A demo dataset assessment, scoped to synthetic fixture data. The status is
-- not a replacement for the observed CDC historical coverage record.
BEGIN;
DO $guard$
BEGIN
  IF current_database() <> 'funnelmetry_handoff' THEN RAISE EXCEPTION 'wrong database'; END IF;
  IF NOT EXISTS (SELECT 1 FROM demo_history.seed_manifest
    WHERE dataset_id='demo-historical-100000-v2'
      AND manifest_sha256='b4316f664d333ae05b2a804ff63bd513c776462e4effe08a4b9a74b869058d0f'
       AND fixture_sha256='5858034aa55353d166fb9c2eaeb21f84f0d966d96e79a69b78e6bc2041544e0b'
       AND logical_sha256='074d25c357a598767e58175bd0b0b2932118b4f6461fdb85d99a50cdcd2b3230')
  THEN RAISE EXCEPTION 'approved demo seed missing'; END IF;
  IF to_regclass('funnelmetry_demo.binding_version') IS NULL THEN
    RAISE EXCEPTION 'demo analytical binding missing';
  END IF;
END $guard$;

-- At-load equality against the pinned fixture was checked in the seed
-- transaction. This assessment checks the present dataset identity, domain
-- counts and temporal boundaries; it does not replace per-row reconciliation.
CREATE OR REPLACE VIEW funnelmetry_demo.dataset_coverage AS
WITH m AS (
  SELECT dataset_id, fixture_sha256, logical_sha256, loaded_at, manifest,
         (manifest->'config'->>'start')::timestamptz AS period_start,
         (manifest->'config'->>'end')::timestamptz AS period_end
  FROM demo_history.seed_manifest WHERE dataset_id='demo-historical-100000-v2'
    AND manifest_sha256='b4316f664d333ae05b2a804ff63bd513c776462e4effe08a4b9a74b869058d0f'
    AND fixture_sha256='5858034aa55353d166fb9c2eaeb21f84f0d966d96e79a69b78e6bc2041544e0b'
    AND logical_sha256='074d25c357a598767e58175bd0b0b2932118b4f6461fdb85d99a50cdcd2b3230'
), actual AS (
  SELECT 'catalog_products' domain,count(*) n FROM demo_history.catalog_products WHERE dataset_id='demo-historical-100000-v2'
  UNION ALL SELECT 'catalog_variants',count(*) FROM demo_history.catalog_variants WHERE dataset_id='demo-historical-100000-v2'
  UNION ALL SELECT 'catalog_categories',count(*) FROM demo_history.catalog_categories WHERE dataset_id='demo-historical-100000-v2'
  UNION ALL SELECT 'product_categories',count(*) FROM demo_history.product_categories WHERE dataset_id='demo-historical-100000-v2'
  UNION ALL SELECT 'category_history',count(*) FROM demo_history.category_history WHERE dataset_id='demo-historical-100000-v2'
  UNION ALL SELECT 'crosswalk',count(*) FROM demo_history.crosswalk WHERE dataset_id='demo-historical-100000-v2'
  UNION ALL SELECT 'coverage',count(*) FROM demo_history.coverage WHERE dataset_id='demo-historical-100000-v2'
  UNION ALL SELECT 'offer_prices',count(*) FROM demo_history.offer_prices WHERE dataset_id='demo-historical-100000-v2'
  UNION ALL SELECT 'stock_positions',count(*) FROM demo_history.stock_positions WHERE dataset_id='demo-historical-100000-v2'
  UNION ALL SELECT 'sessions',count(*) FROM demo_history.sessions WHERE dataset_id='demo-historical-100000-v2'
  UNION ALL SELECT 'browser_events',count(*) FROM demo_history.browser_events WHERE dataset_id='demo-historical-100000-v2'
  UNION ALL SELECT 'cart_changes',count(*) FROM demo_history.cart_changes WHERE dataset_id='demo-historical-100000-v2'
  UNION ALL SELECT 'cart_links',count(*) FROM demo_history.cart_links WHERE dataset_id='demo-historical-100000-v2'
  UNION ALL SELECT 'orders',count(*) FROM demo_history.orders WHERE dataset_id='demo-historical-100000-v2'
  UNION ALL SELECT 'order_transitions',count(*) FROM demo_history.order_transitions WHERE dataset_id='demo-historical-100000-v2'
  UNION ALL SELECT 'order_lines',count(*) FROM demo_history.order_lines WHERE dataset_id='demo-historical-100000-v2'
  UNION ALL SELECT 'payments',count(*) FROM demo_history.payments WHERE dataset_id='demo-historical-100000-v2'
  UNION ALL SELECT 'fulfillments',count(*) FROM demo_history.fulfillments WHERE dataset_id='demo-historical-100000-v2'
  UNION ALL SELECT 'customer_evidence',count(*) FROM demo_history.customer_evidence WHERE dataset_id='demo-historical-100000-v2'
), checks AS (
  SELECT m.*, (SELECT count(*) FROM actual WHERE n <> COALESCE((m.manifest->'counts'->>domain)::bigint,-1)) AS mismatched_domains,
    (SELECT count(*) FROM demo_history.sessions s WHERE s.dataset_id=m.dataset_id AND (s.started_at<m.period_start OR s.started_at>=m.period_end OR s.origin<>'SYNTHETIC_BACKFILL')) AS invalid_sessions
  FROM m
)
SELECT dataset_id, 'SYNTHETIC_BACKFILL'::text AS origin, 'synthetic_history'::text AS source_id,
       period_start, period_end, 'UTC'::text AS time_zone, fixture_sha256, logical_sha256,
       loaded_at, mismatched_domains, invalid_sessions,
       CASE WHEN mismatched_domains=0 AND invalid_sessions=0 THEN 'READY_FOR_DEMO'
            ELSE 'DEMO_DATA_MISMATCH' END::text AS demo_status,
       'Synthetic dataset; count and session range checked. Not Medusa source history.'::text AS scope_note
FROM checks;
COMMENT ON VIEW funnelmetry_demo.dataset_coverage IS
  'Demo-only fixture readiness. READY_FOR_DEMO means pinned manifest domain counts and session time boundary match; it does not certify observed CDC or current row hashes.';
GRANT SELECT ON funnelmetry_demo.dataset_coverage TO funnelmetry_ai_agent;
COMMIT;
