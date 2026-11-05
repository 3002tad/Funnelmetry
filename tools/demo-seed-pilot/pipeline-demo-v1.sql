-- DEC-150: synthetic history in the existing Pipeline database. No grants are added.
BEGIN;
SELECT pg_advisory_xact_lock(hashtextextended('funnelmetry-demo-history-v1', 0));
DO $guard$
BEGIN
  IF current_database() <> 'funnelmetry_handoff' THEN
    RAISE EXCEPTION 'wrong database: expected funnelmetry_handoff';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'demo_history')
     AND to_regclass('demo_history.schema_version') IS NULL THEN
    RAISE EXCEPTION 'demo_history schema exists without Funnelmetry migration ownership';
  END IF;
END
$guard$;
CREATE SCHEMA IF NOT EXISTS demo_history;
REVOKE ALL ON SCHEMA demo_history FROM PUBLIC;
CREATE TABLE IF NOT EXISTS demo_history.schema_version (
  version text PRIMARY KEY CHECK (version = 'pipeline-demo-v1'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $version$
BEGIN
  IF EXISTS (SELECT 1 FROM demo_history.schema_version WHERE version <> 'pipeline-demo-v1') THEN
    RAISE EXCEPTION 'incompatible demo_history schema version';
  END IF;
END
$version$;
INSERT INTO demo_history.schema_version(version) VALUES ('pipeline-demo-v1') ON CONFLICT DO NOTHING;
CREATE TABLE IF NOT EXISTS demo_history.seed_manifest (
  dataset_id text PRIMARY KEY,
  manifest_sha256 text NOT NULL,
  fixture_sha256 text NOT NULL,
  logical_sha256 text NOT NULL,
  manifest jsonb NOT NULL,
  loaded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Each table is typed at its domain grain. Ordinal records the deterministic
-- order in the pinned fixture; natural keys reject a duplicate entity/revision.
DO $tables$
DECLARE spec record;
BEGIN
  FOR spec IN SELECT * FROM (VALUES
    ('catalog_products', 'product_id text, title text, label_origin text', 'product_id'),
    ('catalog_variants', 'variant_id text, product_id text', 'variant_id'),
    ('catalog_categories', 'category_id text, name text, label_origin text', 'category_id'),
    ('product_categories', 'product_id text, category_id text', 'product_id, category_id'),
    ('category_history', 'product_id text, category_id text, revision int, valid_from timestamptz, valid_to timestamptz', 'product_id, category_id, revision'),
    ('crosswalk', 'entity_type text, demo_entity_key text, source_id text, source_entity_id text, mapping_status text, mapping_evidence text, snapshot_at timestamptz', 'entity_type, demo_entity_key, source_id'),
    ('coverage', 'domain text, source_id text, coverage_epoch text, interval_start timestamptz, interval_end timestamptz, status text, basis text', 'domain, source_id, coverage_epoch, interval_start'),
    ('offer_prices', 'variant_key text, revision int, effective_at timestamptz, valid_to timestamptz, currency text, amount_minor int, channel text, region text, price_rule text', 'variant_key, revision, price_rule, currency, channel, region'),
    ('stock_positions', 'inventory_item_key text, variant_key text, revision int, effective_at timestamptz, valid_to timestamptz, location text, channel text, stocked int, reserved int, incoming int, manage_inventory bool, allow_backorder bool, required_quantity int', 'inventory_item_key, revision, location, channel'),
    ('sessions', 'session_id text, started_at timestamptz, ended_at timestamptz, event_count int, device text, utm_source text, customer_key text', 'session_id'),
    ('browser_events', 'event_id text, session_id text, event_type text, occurred_at timestamptz, data jsonb, utm_source text', 'event_id'),
    ('cart_changes', 'cart_id text, line_item_id text, revision int, product_key text, variant_key text, before_quantity int, after_quantity int, change_type text, change_at timestamptz', 'cart_id, line_item_id, revision'),
    ('cart_links', 'session_id text, cart_id text, event_id text, occurred_at timestamptz, evidence_type text', 'event_id'),
    ('orders', 'order_id text, cart_id text, customer_key text, status text, currency text, created_at timestamptz, reference_state text, transition_at timestamptz, checkout_event_id text', 'order_id'),
    ('order_transitions', 'order_id text, transition_id text, state text, transition_at timestamptz, transition_kind text', 'transition_id'),
    ('order_lines', 'order_id text, line_id text, product_key text, variant_key text, quantity int, unit_amount_minor int, line_total_minor int, price_rule text, currency text, ordered_at timestamptz', 'order_id, line_id'),
    ('payments', 'order_id text, payment_id text, action_id text, action text, amount_minor int, currency text, action_at timestamptz', 'action_id'),
    ('fulfillments', 'order_id text, fulfillment_id text, transition_id text, state text, occurred_at timestamptz, line_ids jsonb', 'transition_id'),
    ('customer_evidence', 'customer_key text, evidence_id text, session_id text, cart_id text, order_id text, evidence_type text, observed_at timestamptz', 'evidence_id')
  ) AS v(name, columns_sql, key_sql) LOOP
    EXECUTE format('CREATE TABLE IF NOT EXISTS demo_history.%I (dataset_id text NOT NULL REFERENCES demo_history.seed_manifest(dataset_id), ordinal integer NOT NULL CHECK (ordinal > 0), origin text NOT NULL DEFAULT ''SYNTHETIC_BACKFILL'' CHECK (origin = ''SYNTHETIC_BACKFILL''), loaded_at timestamptz NOT NULL DEFAULT clock_timestamp(), %s, PRIMARY KEY (dataset_id, ordinal), UNIQUE (dataset_id, %s))', spec.name, spec.columns_sql, spec.key_sql);
  END LOOP;
END
$tables$;
COMMIT;
