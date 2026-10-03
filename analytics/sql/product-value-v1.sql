-- Opt-in staged asset. Does not rewrite canonical history or existing order measures.
CREATE OR REPLACE VIEW analytical_product_order_items_v1 AS
WITH order_items AS (
  SELECT f.source_id, f.order_id, f.currency_code, f.order_placed_at,
    f.canonical_event_ids, f.quality_state AS order_quality,
    count(DISTINCT e.data->'items') AS item_versions,
    bool_and(COALESCE(jsonb_typeof(e.data->'items') = 'array',false)) AS arrays_valid,
    (array_agg(e.data->'items' ORDER BY e.canonical_event_id))[1] AS items
  FROM analytical_fact_order_v1 f
  JOIN canonical_events e ON e.source_id=f.source_id
    AND e.canonical_event_id=ANY(f.canonical_event_ids)
  GROUP BY f.source_id,f.order_id,f.currency_code,f.order_placed_at,
    f.canonical_event_ids,f.quality_state
), expanded AS (
  SELECT o.*, i.item, i.item_position,
    CASE WHEN jsonb_typeof(i.item->'unit_price_amount')='string'
      AND length(i.item->>'unit_price_amount')<=64
      AND i.item->>'unit_price_amount' ~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$'
      THEN (i.item->>'unit_price_amount')::numeric END AS unit_amount,
    CASE WHEN jsonb_typeof(i.item->'quantity')='number'
      AND length(i.item->>'quantity')<=16
      AND i.item->>'quantity' ~ '^[1-9][0-9]*$'
      THEN (i.item->>'quantity')::numeric END AS units
  FROM order_items o LEFT JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(o.items)='array' THEN o.items ELSE '[]'::jsonb END
  ) WITH ORDINALITY i(item,item_position) ON true
)
SELECT source_id,order_id,currency_code,order_placed_at,canonical_event_ids,item_position,
  item->>'product_id' AS product_id, units AS quantity,
  unit_amount * units AS ordered_product_unit_value,
  CASE WHEN order_quality='VALID' AND arrays_valid AND item_versions=1
    AND unit_amount IS NOT NULL AND units BETWEEN 1 AND 9007199254740991
    AND jsonb_typeof(item->'product_id')='string'
    AND item->>'product_id' ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$'
    AND jsonb_typeof(item->'variant_id')='string'
    AND item->>'variant_id' ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$'
    AND NOT item ? 'unit_price_minor'
    THEN 'VALID' ELSE 'BLOCKED_BY_QUALITY' END AS quality_state
FROM expanded;
