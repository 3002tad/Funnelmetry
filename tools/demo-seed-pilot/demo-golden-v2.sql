-- DEC-150 analytical benchmark v1. Run with funnelmetry_ai_agent on the VPS.
-- Each output line is one JSON answer. All amounts are EUR minor units.
SET statement_timeout = '30s';
SET TIME ZONE 'UTC';

-- Q01 Monthly session and browser-event trend; session/event grains stay separate.
WITH s AS (SELECT date_trunc('month',started_at) AS month_start,count(*) sessions FROM funnelmetry_demo.sessions GROUP BY 1),
 e AS (SELECT date_trunc('month',occurred_at) AS month_start,count(*) events FROM funnelmetry_demo.browser_events GROUP BY 1)
SELECT jsonb_build_object('id','Q01','rows',jsonb_agg(jsonb_build_object('month',to_char(s.month_start,'YYYY-MM'),'sessions',s.sessions,'events',e.events) ORDER BY s.month_start))
FROM s JOIN e USING(month_start);

-- Q02 Device mix at session grain.
SELECT jsonb_build_object('id','Q02','rows',jsonb_agg(jsonb_build_object('device',device,'sessions',n) ORDER BY n DESC,device))
FROM (SELECT device,count(*) n FROM funnelmetry_demo.sessions GROUP BY 1) q;

-- Q03 Raw UTM distribution and explicit cart-link sessions.
WITH linked AS (SELECT DISTINCT dataset_id,session_id FROM funnelmetry_demo.cart_links),
 grouped AS (SELECT coalesce(s.utm_source,'[absent]') raw_utm_source,count(*) sessions,
 count(l.session_id) sessions_with_cart_link FROM funnelmetry_demo.sessions s
 LEFT JOIN linked l ON l.dataset_id=s.dataset_id AND l.session_id=s.session_id GROUP BY 1)
SELECT jsonb_build_object('id','Q03','rows',jsonb_agg(to_jsonb(grouped) ORDER BY sessions DESC,raw_utm_source)) FROM grouped;

-- Q04 Top products by distinct product-view events. Repeat catalog rows are scoped by dataset_id.
WITH ranked AS (SELECT e.dataset_id,e.data->>'product_id' product_id,count(*) views
 FROM funnelmetry_demo.browser_events e WHERE event_type='behavior.product_viewed' GROUP BY 1,2),
 total AS (SELECT r.product_id,max(p.title) title,sum(r.views) views FROM ranked r
 JOIN funnelmetry_demo.catalog_products p ON p.dataset_id=r.dataset_id AND p.product_id=r.product_id GROUP BY r.product_id)
SELECT jsonb_build_object('id','Q04','rows',jsonb_agg(to_jsonb(t) ORDER BY views DESC,product_id))
FROM (SELECT * FROM total ORDER BY views DESC,product_id LIMIT 10) t;

-- Q05 Product views attributed to category valid at event time.
WITH grouped AS (SELECT c.name category,count(DISTINCT (e.dataset_id,e.event_id)) product_view_events
 FROM funnelmetry_demo.browser_events e
 JOIN funnelmetry_demo.category_history h ON h.dataset_id=e.dataset_id AND h.product_id=e.data->>'product_id'
   AND h.valid_from<=e.occurred_at AND e.occurred_at<h.valid_to
 JOIN funnelmetry_demo.catalog_categories c ON c.dataset_id=h.dataset_id AND c.category_id=h.category_id
 WHERE e.event_type='behavior.product_viewed' GROUP BY c.name)
SELECT jsonb_build_object('id','Q05','rows',jsonb_agg(to_jsonb(grouped) ORDER BY product_view_events DESC,category)) FROM grouped;

-- Q06 Search terms are an independent demand signal; no search-to-cart attribution.
WITH terms AS (SELECT data->>'query_normalized' query_normalized,count(*) searches
 FROM funnelmetry_demo.browser_events WHERE event_type='behavior.search_query_submitted' GROUP BY 1),
 top AS (SELECT * FROM terms ORDER BY searches DESC,query_normalized LIMIT 10)
SELECT jsonb_build_object('id','Q06','rows',jsonb_agg(to_jsonb(top) ORDER BY searches DESC,query_normalized)) FROM top;

-- Q07 Cart mutation distribution at change grain and distinct-cart grain.
WITH grouped AS (SELECT change_type,count(*) mutations,count(DISTINCT (dataset_id,cart_id)) carts
 FROM funnelmetry_demo.cart_changes GROUP BY 1)
SELECT jsonb_build_object('id','Q07','rows',jsonb_agg(to_jsonb(grouped) ORDER BY change_type)) FROM grouped;

-- Q08 Demo funnel evidence: session/event/cart/order counts are different grains.
SELECT jsonb_build_object('id','Q08','sessions',(SELECT count(*) FROM funnelmetry_demo.sessions),
 'sessions_with_product_view',(SELECT count(DISTINCT (dataset_id,session_id)) FROM funnelmetry_demo.browser_events WHERE event_type='behavior.product_viewed'),
 'sessions_with_cart_link',(SELECT count(DISTINCT (dataset_id,session_id)) FROM funnelmetry_demo.cart_links),
 'sessions_with_checkout_started',(SELECT count(DISTINCT (dataset_id,session_id)) FROM funnelmetry_demo.browser_events WHERE event_type='checkout.started'),
 'orders_recorded',(SELECT count(*) FROM funnelmetry_demo.orders),
 'active_order_rows',(SELECT count(*) FROM funnelmetry_demo.orders WHERE reference_state='ON'));

-- Q09 Synthetic order current-state distribution by creation month.
WITH grouped AS (SELECT to_char(date_trunc('month',created_at),'YYYY-MM') AS month_label,reference_state,count(*) order_rows
 FROM funnelmetry_demo.orders GROUP BY 1,2)
SELECT jsonb_build_object('id','Q09','rows',jsonb_agg(to_jsonb(grouped) ORDER BY month_label,reference_state)) FROM grouped;

-- Q10 Historical synthetic line value by recorded price rule; not paid revenue.
WITH grouped AS (SELECT currency,price_rule,count(*) order_lines,sum(quantity) units,sum(line_total_minor) ordered_line_value_minor
 FROM funnelmetry_demo.order_lines GROUP BY 1,2)
SELECT jsonb_build_object('id','Q10','rows',jsonb_agg(to_jsonb(grouped) ORDER BY currency,price_rule)) FROM grouped;

-- Q11 Synthetic payment lifecycle, grouped by action and currency.
WITH grouped AS (SELECT currency,action,count(*) actions,sum(amount_minor) amount_minor
 FROM funnelmetry_demo.payments GROUP BY 1,2)
SELECT jsonb_build_object('id','Q11','rows',jsonb_agg(to_jsonb(grouped) ORDER BY currency,action)) FROM grouped;

-- Q12 Fulfillment states and unique orders at each state.
WITH grouped AS (SELECT state,count(*) transitions,count(DISTINCT (dataset_id,order_id)) orders
 FROM funnelmetry_demo.fulfillments GROUP BY 1)
SELECT jsonb_build_object('id','Q12','rows',jsonb_agg(to_jsonb(grouped) ORDER BY state)) FROM grouped;

-- Q13 Returning-customer evidence only within a synthetic segment.
WITH customer_orders AS (SELECT dataset_id,customer_key,count(DISTINCT order_id) orders
 FROM funnelmetry_demo.customer_evidence WHERE evidence_type='SYNTHETIC_CUSTOMER_ORDER_LINK'
 GROUP BY 1,2)
SELECT jsonb_build_object('id','Q13','customers_with_evidence',count(*),
 'customers_with_multiple_orders',count(*) FILTER (WHERE orders>=2),
 'max_orders_for_one_customer',max(orders)) FROM customer_orders;

-- Q14 Synthetic inventory positions for the gap segment on 2026-11-04.
-- stocked-reserved is a physical position, not Medusa sellable quantity.
WITH grouped AS (SELECT location,count(*) variant_positions,
 sum(stocked) stocked,sum(reserved) reserved,sum(stocked-reserved) physical_unreserved,
 count(*) FILTER (WHERE stocked-reserved>=required_quantity) positions_meeting_required_quantity
 FROM funnelmetry_demo.stock_positions WHERE dataset_id='demo-gap-20261101-20261105-v2-utm'
 AND effective_at<='2026-11-04T12:00:00Z' AND '2026-11-04T12:00:00Z'<valid_to
 GROUP BY 1)
SELECT jsonb_build_object('id','Q14','rows',jsonb_agg(to_jsonb(grouped) ORDER BY location)) FROM grouped;

-- Q15 Unsupported observed-business claims and current coverage status.
SELECT jsonb_build_object('id','Q15',
 'historic_seed_status',(SELECT demo_status FROM funnelmetry_demo.dataset_coverage),
 'gap_seed_status',(SELECT demo_status FROM funnelmetry_demo.gap_dataset_coverage),
 'observed_overlap',(SELECT observed_overlap_count FROM funnelmetry_demo.gap_overlap_status),
 'observed_browser_events_after_boundary',(SELECT count(*) FROM funnelmetry_demo.behavior_events_all WHERE origin='OBSERVED_SOURCE'),
 'observed_paid_revenue_answer','INSUFFICIENT_CONTRACT',
 'observed_search_to_cart_answer','INSUFFICIENT_CORRELATION',
 'reason','Payment facts and cart/search identity in funnelmetry_demo are synthetic; observed CDC current state and browser search do not prove these combined business claims');
