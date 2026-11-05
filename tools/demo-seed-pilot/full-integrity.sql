-- Checks only the synthetic offline database. The dataset is isolated per database.
-- Materialize extracted columns once, avoiding repeated JSON scans on the pilot schema.
CREATE TEMP TABLE audit_browser_events AS SELECT * FROM demo.browser_events;
CREATE TEMP TABLE audit_sessions AS SELECT * FROM demo.sessions;
CREATE TEMP TABLE audit_orders AS SELECT * FROM demo.orders;
CREATE TEMP TABLE audit_cart_changes AS SELECT * FROM demo.cart_changes;
CREATE TEMP TABLE audit_cart_links AS SELECT * FROM demo.cart_links;
CREATE TEMP TABLE audit_order_lines AS SELECT * FROM demo.order_lines;
CREATE TEMP TABLE audit_catalog_variants AS SELECT * FROM demo.catalog_variants;
CREATE TEMP TABLE audit_catalog_products AS SELECT * FROM demo.catalog_products;
CREATE TEMP TABLE audit_catalog_categories AS SELECT * FROM demo.catalog_categories;
CREATE TEMP TABLE audit_category_history AS SELECT * FROM demo.category_history;
CREATE TEMP TABLE audit_offer_prices AS SELECT * FROM demo.offer_prices;
CREATE TEMP TABLE audit_payments AS SELECT * FROM demo.payments;
CREATE TEMP TABLE audit_fulfillments AS SELECT * FROM demo.fulfillments;
CREATE TEMP TABLE audit_coverage AS SELECT * FROM demo.coverage;
CREATE INDEX ON audit_cart_changes (cart_id,line_item_id,revision);
CREATE INDEX ON audit_browser_events (event_id);
CREATE INDEX ON audit_order_lines (order_id,line_id);
CREATE INDEX ON audit_orders (order_id);
CREATE INDEX ON audit_catalog_variants (variant_id,product_id);
CREATE INDEX ON audit_offer_prices (variant_key,price_rule,currency);
ANALYZE;
GRANT SELECT ON audit_browser_events,audit_sessions,audit_orders,audit_cart_changes,audit_cart_links,audit_order_lines,audit_catalog_variants,audit_catalog_products,audit_catalog_categories,audit_category_history,audit_offer_prices,audit_payments,audit_fulfillments,audit_coverage TO demo_reader;
SET ROLE demo_reader;
WITH latest_cart AS (
  SELECT DISTINCT ON (cart_id,line_item_id) cart_id,line_item_id,variant_key,after_quantity
  FROM audit_cart_changes ORDER BY cart_id,line_item_id,revision DESC
), cart_quantities AS (
  SELECT cart_id,jsonb_agg(jsonb_build_array(variant_key,after_quantity) ORDER BY variant_key,after_quantity) lines
  FROM latest_cart WHERE after_quantity>0 GROUP BY cart_id
), order_quantities AS (
  SELECT order_id,jsonb_agg(jsonb_build_array(variant_key,quantity) ORDER BY variant_key,quantity) lines
  FROM audit_order_lines GROUP BY order_id
), revisions AS (
  SELECT revision,before_quantity,after_quantity,change_type,
    lag(revision) OVER(PARTITION BY cart_id,line_item_id ORDER BY revision) prior_revision,
    lag(after_quantity) OVER(PARTITION BY cart_id,line_item_id ORDER BY revision) prior_quantity
  FROM audit_cart_changes
)
SELECT json_build_object(
 'duplicate_events',(SELECT count(*)-count(DISTINCT event_id) FROM audit_browser_events),
 'duplicate_sessions',(SELECT count(*)-count(DISTINCT session_id) FROM audit_sessions),
 'duplicate_orders',(SELECT count(*)-count(DISTINCT order_id) FROM audit_orders),
 'orphan_events',(SELECT count(*) FROM audit_browser_events e LEFT JOIN audit_sessions s USING(session_id) WHERE s.session_id IS NULL),
 'orphan_products',(SELECT count(*) FROM audit_browser_events e LEFT JOIN audit_catalog_variants v ON v.variant_id=e.data->>'variant_id' AND v.product_id=e.data->>'product_id' WHERE e.event_type='behavior.product_viewed' AND v.variant_id IS NULL),
 'bad_cart_revisions',(SELECT count(*) FROM revisions WHERE before_quantity<0 OR after_quantity<0 OR (revision=1 AND before_quantity<>0) OR (revision>1 AND (prior_revision IS NULL OR revision<>prior_revision+1 OR before_quantity<>prior_quantity)) OR (change_type='ADD' AND after_quantity<=before_quantity) OR (change_type='DECREASE' AND NOT(after_quantity>0 AND after_quantity<before_quantity)) OR (change_type='DELETE' AND NOT(after_quantity=0 AND before_quantity>0))),
 'bad_cart_link',(SELECT count(*) FROM audit_cart_links l LEFT JOIN audit_browser_events e ON e.event_id=l.event_id AND e.session_id=l.session_id AND e.event_type='context.cart_linked' AND e.data->>'cart_id'=l.cart_id WHERE e.event_id IS NULL OR NOT EXISTS(SELECT 1 FROM audit_cart_changes c WHERE c.cart_id=l.cart_id)),
 'bad_order_checkout',(SELECT count(*) FROM audit_orders o LEFT JOIN audit_browser_events e ON e.event_id=o.checkout_event_id AND e.event_type='checkout.started' AND e.data->>'cart_id'=o.cart_id WHERE e.event_id IS NULL OR e.occurred_at>o.created_at),
 'bad_order_cart_quantities',(SELECT count(*) FROM audit_orders o LEFT JOIN cart_quantities c USING(cart_id) LEFT JOIN order_quantities l USING(order_id) WHERE c.lines IS NULL OR l.lines IS NULL OR c.lines<>l.lines),
 'orphan_order_lines',(SELECT count(*) FROM audit_order_lines l LEFT JOIN audit_orders o USING(order_id) LEFT JOIN audit_catalog_variants v ON v.variant_id=l.variant_key AND v.product_id=l.product_key WHERE o.order_id IS NULL OR v.variant_id IS NULL OR o.currency<>l.currency OR l.line_total_minor<>l.quantity*l.unit_amount_minor),
 'bad_price',(SELECT count(*) FROM audit_order_lines l LEFT JOIN audit_offer_prices p ON p.variant_key=l.variant_key AND p.price_rule=l.price_rule AND p.currency=l.currency AND p.effective_at<=l.ordered_at AND l.ordered_at<p.valid_to WHERE p.variant_key IS NULL OR p.amount_minor<>l.unit_amount_minor),
 'bad_payment',(SELECT count(*) FROM audit_payments p LEFT JOIN audit_orders o USING(order_id) WHERE o.order_id IS NULL OR p.currency<>o.currency OR p.action_at<o.created_at OR p.action_at>='2026-11-01T00:00:00Z'),
 'bad_fulfillment',(SELECT count(*) FROM audit_fulfillments f LEFT JOIN audit_orders o USING(order_id) WHERE o.order_id IS NULL OR f.occurred_at<o.created_at OR f.occurred_at>='2026-11-01T00:00:00Z' OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(f.line_ids) a WHERE NOT EXISTS(SELECT 1 FROM audit_order_lines l WHERE l.order_id=f.order_id AND l.line_id=a))),
 'bad_event_time',(SELECT count(*) FROM audit_browser_events e JOIN audit_sessions s USING(session_id) WHERE e.occurred_at<s.started_at OR e.occurred_at>s.ended_at OR e.occurred_at<'2025-11-01T00:00:00Z' OR e.occurred_at>='2026-11-01T00:00:00Z' OR e.loaded_at<=e.occurred_at),
 'bad_order_time',(SELECT count(*) FROM audit_orders WHERE created_at<'2025-11-01T00:00:00Z' OR created_at>='2026-11-01T00:00:00Z' OR transition_at<created_at OR transition_at>='2026-11-01T00:00:00Z'),
 'bad_category_range',(SELECT count(*) FROM audit_category_history h LEFT JOIN audit_catalog_categories c ON c.category_id=h.category_id LEFT JOIN audit_catalog_products p ON p.product_id=h.product_id WHERE c.category_id IS NULL OR p.product_id IS NULL OR h.valid_to<=h.valid_from),
 'bad_origin',(SELECT count(*) FROM demo.records WHERE origin<>'SYNTHETIC_BACKFILL' OR dataset_id<>'demo-historical-100000-v2'),
 'bad_synthetic_coverage',(SELECT count(*) FROM audit_coverage WHERE status<>'UNVERIFIED' OR source_id<>'synthetic_history')
);
