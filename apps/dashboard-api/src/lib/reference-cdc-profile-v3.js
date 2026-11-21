import {REFERENCE_CDC_PROFILE_V2} from './reference-cdc-profile-v2.js'

// New analytical semantics; the immutable v2 release remains available for rollback.
export const REFERENCE_CDC_PROFILE_V3 = Object.freeze({
  ...REFERENCE_CDC_PROFILE_V2,
  profile_version:'3.0.0',
  metric_id:'metric.reference_linked_currently_recorded_journey_count',
  metric_version:'3.0.0',
  display_name:'Reference commerce current state with explicit cart context',
  grain:['source_instance_id','coverage_epoch_id','entry_journey_id'],
  linkage_contract:{
    id:'reference.product_page_cart_bridge.v1',
    evidence:'context.cart_linked',
    keys:['source_id','session_id','page_instance_id','cart_id'],
    ordering:'product view <= cart context; product view <= cart add <= checkout <= terminal ON',
    cart_authority:'exact CART business entity with STRONG confidence',
    cardinality:'one cart maps to at most one entry journey across post-activation evidence; one entry may map to multiple carts',
    ambiguity:'exclude a cart linked to multiple entry journeys, even outside the selected cohort window',
    aggregation:'distinct entry journey at each stage; checkout and terminal must follow addition on the same cart',
    persistence:'read-only analytical bridge; never merges or rewrites journey identities',
    late_arrival:'recompute from occurred_at on every read; late evidence may add or retract ambiguous attribution',
    horizon:'no additional timeout; preserve v2 post-activation current-state observation semantics',
  },
  metric:{...REFERENCE_CDC_PROFILE_V2.metric,
    formula:'COUNT(DISTINCT entry_journey_id) with an unambiguous explicit cart path and current terminal ON after checkout and activation'},
  quality_requirements:[...REFERENCE_CDC_PROFILE_V2.quality_requirements,'exact session and product-page context','unambiguous cart to entry journey'],
  limitations:[...REFERENCE_CDC_PROFILE_V2.limitations,
    'Missing or ambiguous cart context is excluded from downstream stages and reported separately',
    'Not session/customer counts, search attribution or a historical conversion rate',
    'Cohort is first post-activation product view per browser entry journey; terminal remains retractable'],
})

export const FUNNEL_BRIDGE_SQL = `WITH events AS (
  SELECT je.journey_id,c.canonical_event_id,c.event_type,c.occurred_at,c.identity,c.relations,c.data
  FROM journey_events je
  JOIN canonical_events c ON c.canonical_event_id=je.canonical_event_id
  JOIN journeys j ON j.journey_id=je.journey_id AND j.source_id=c.source_id
  WHERE c.source_id=$1 AND c.event_type IN
    ('behavior.product_viewed','context.cart_linked','cart.item_added','checkout.started')
), entries AS (
  SELECT journey_id,min(occurred_at) AS entry_at FROM events
  WHERE event_type='behavior.product_viewed' AND occurred_at >= $3::timestamptz
  GROUP BY journey_id
), cohort AS (
  SELECT * FROM entries
  WHERE ($4::timestamptz IS NULL OR entry_at >= $4::timestamptz)
    AND ($5::timestamptz IS NULL OR entry_at < $5::timestamptz)
), bridges AS (
  SELECT p.journey_id AS entry_journey_id,ce.entity_key AS cart_id,
    ce.journey_id AS cart_journey_id,min(p.occurred_at) AS viewed_at
  FROM events b
  JOIN events p ON p.event_type='behavior.product_viewed'
    AND nullif(btrim(p.identity->>'session_id'),'')=nullif(btrim(b.identity->>'session_id'),'')
    AND nullif(btrim(p.data->>'page_instance_id'),'')=nullif(btrim(b.data->>'page_instance_id'),'')
    AND p.occurred_at <= b.occurred_at AND p.occurred_at >= $3::timestamptz
  JOIN journey_entities ce ON ce.source_id=$1 AND ce.entity_type='CART'
    AND ce.link_confidence='STRONG'
    AND ce.entity_key=nullif(btrim(b.data->>'cart_id'),'')
  JOIN journeys cj ON cj.journey_id=ce.journey_id AND cj.source_id=$1
  WHERE b.event_type='context.cart_linked'
    AND b.relations->>'cart_id'=b.data->>'cart_id'
  GROUP BY p.journey_id,ce.entity_key,ce.journey_id
), cart_owners AS (
  SELECT cart_id,count(DISTINCT entry_journey_id) AS owner_count FROM bridges GROUP BY cart_id
), linked AS (
  SELECT b.* FROM bridges b JOIN cart_owners o USING(cart_id)
  JOIN cohort c ON c.journey_id=b.entry_journey_id WHERE o.owner_count=1
), added AS (
  SELECT l.entry_journey_id,l.cart_id,l.cart_journey_id,min(e.occurred_at) AS added_at
  FROM linked l JOIN events e ON e.journey_id=l.cart_journey_id
    AND e.event_type='cart.item_added' AND e.occurred_at>=l.viewed_at
    AND coalesce(e.relations->>'cart_id',e.data->>'cart_id')=l.cart_id
    AND (e.relations->>'cart_id' IS NULL OR e.relations->>'cart_id'=l.cart_id)
    AND (e.data->>'cart_id' IS NULL OR e.data->>'cart_id'=l.cart_id)
  GROUP BY l.entry_journey_id,l.cart_id,l.cart_journey_id
), checkout AS (
  SELECT a.entry_journey_id,a.cart_id,a.cart_journey_id,min(e.occurred_at) AS checkout_at
  FROM added a JOIN events e ON e.journey_id=a.cart_journey_id
    AND e.event_type='checkout.started' AND e.occurred_at>=a.added_at
    AND coalesce(e.relations->>'cart_id',e.data->>'cart_id')=a.cart_id
    AND (e.relations->>'cart_id' IS NULL OR e.relations->>'cart_id'=a.cart_id)
    AND (e.data->>'cart_id' IS NULL OR e.data->>'cart_id'=a.cart_id)
  GROUP BY a.entry_journey_id,a.cart_id,a.cart_journey_id
), recorded AS (
  SELECT DISTINCT ch.entry_journey_id
  FROM reference_cdc_v2_funnel_terminal_candidate t
  JOIN checkout ch ON ch.cart_journey_id=t.journey_id AND ch.cart_id=t.cart_id
  JOIN canonical_events e ON e.canonical_event_id=t.checkout_event_id
    AND e.source_id=$1 AND e.event_type='checkout.started'
  WHERE t.source_instance_id=$1 AND t.coverage_epoch_id=$2
    AND t.observed_state_at::timestamptz >= $3::timestamptz
    AND e.occurred_at >= ch.checkout_at
    AND t.observed_state_at::timestamptz >= e.occurred_at
)
SELECT (SELECT count(*) FROM cohort)::bigint AS entrants,
  (SELECT count(DISTINCT entry_journey_id) FROM added)::bigint AS item_added,
  (SELECT count(DISTINCT entry_journey_id) FROM checkout)::bigint AS checkout_started,
  (SELECT count(*) FROM recorded)::bigint AS currently_recorded_journeys,
  (SELECT count(DISTINCT entry_journey_id) FROM linked)::bigint AS linked_entry_journeys,
  (SELECT count(DISTINCT b.cart_id) FROM bridges b JOIN cart_owners o USING(cart_id)
    JOIN cohort c ON c.journey_id=b.entry_journey_id WHERE o.owner_count>1)::bigint AS ambiguous_carts,
  (SELECT count(*) FROM cohort c WHERE NOT EXISTS
    (SELECT 1 FROM bridges b WHERE b.entry_journey_id=c.journey_id))::bigint AS entries_without_cart_context`
