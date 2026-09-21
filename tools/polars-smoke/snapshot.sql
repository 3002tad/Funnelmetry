BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '10s';
WITH scope AS (
  SELECT now() - interval '24 hours' AS since, now() AS until
), rows AS MATERIALIZED (
  SELECT event_type
  FROM canonical_events, scope
  WHERE source_id = 'medusa-reference'
    AND occurred_at >= scope.since AND occurred_at < scope.until
  ORDER BY occurred_at, canonical_event_id
  LIMIT 10001
), counts AS (
  SELECT event_type, count(*) AS count FROM rows GROUP BY event_type
)
SELECT json_build_object(
  'source_id', 'medusa-reference',
  'from', scope.since, 'to', scope.until,
  'event_types', COALESCE((SELECT json_agg(event_type) FROM rows), '[]'::json),
  'sql_counts', COALESCE((SELECT json_object_agg(event_type, count) FROM counts), '{}'::json)
) FROM scope;
ROLLBACK;
