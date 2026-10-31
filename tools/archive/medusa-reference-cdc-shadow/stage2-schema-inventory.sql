-- Read-only inventory of the inventory/price CDC candidate on the isolated clone.
-- Do not run a stage-2 connector before checking column and primary-key semantics.
SELECT c.table_name || '|' ||
       string_agg(c.column_name || ':' || c.data_type, ',' ORDER BY c.ordinal_position)
FROM information_schema.columns AS c
WHERE c.table_schema = 'public'
  AND c.table_name IN (
    'product_sales_channel', 'sales_channel', 'sales_channel_stock_location',
    'stock_location', 'product_variant_inventory_item', 'inventory_item',
    'inventory_level', 'reservation_item', 'product_variant_price_set',
    'price_set', 'price', 'price_list', 'price_rule', 'price_list_rule',
    'region', 'currency'
  )
GROUP BY c.table_name
ORDER BY c.table_name;

SELECT t.relname || '|pk=' ||
       COALESCE(string_agg(a.attname, ',' ORDER BY u.ordinality), 'NONE')
FROM pg_class AS t
JOIN pg_namespace AS n ON n.oid = t.relnamespace AND n.nspname = 'public'
LEFT JOIN pg_constraint AS k ON k.conrelid = t.oid AND k.contype = 'p'
LEFT JOIN LATERAL unnest(k.conkey) WITH ORDINALITY AS u(attnum, ordinality) ON true
LEFT JOIN pg_attribute AS a ON a.attrelid = t.oid AND a.attnum = u.attnum
WHERE t.relname IN (
  'product_sales_channel', 'sales_channel', 'sales_channel_stock_location',
  'stock_location', 'product_variant_inventory_item', 'inventory_item',
  'inventory_level', 'reservation_item', 'product_variant_price_set',
  'price_set', 'price', 'price_list', 'price_rule', 'price_list_rule',
  'region', 'currency'
)
GROUP BY t.relname
ORDER BY t.relname;
