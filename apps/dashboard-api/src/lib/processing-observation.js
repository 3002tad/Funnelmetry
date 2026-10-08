// One statement gives a consistent PostgreSQL snapshot. Counts have different
// grains: never subtract them to infer Kafka lag, loss, or pending work.
export const PROCESSING_OBSERVATION_SQL = `
WITH outcomes AS (
  SELECT status, COUNT(*)::text AS retained_count,
    MAX(processed_at) AS last_processed_at, MAX(recorded_at) AS last_recorded_at
  FROM canonicalization_latest_outcomes WHERE source_id=$1 GROUP BY status
)
SELECT statuses.stage, COALESCE(outcomes.retained_count, '0') AS retained_count,
  outcomes.last_processed_at, outcomes.last_recorded_at
FROM (VALUES ('normalized'), ('unsupported'), ('quarantined')) AS statuses(stage)
LEFT JOIN outcomes ON outcomes.status=statuses.stage
UNION ALL
SELECT 'canonical', COUNT(*)::text, MAX(normalized_at), MAX(persisted_at)
FROM canonical_events WHERE source_id=$1
UNION ALL
SELECT 'kpi', COUNT(*)::text, MAX(applied_at), MAX(applied_at)
FROM kpi_projection_applications WHERE source_id=$1`

export function parseProcessingSource(query) {
  if (Object.keys(query).some(key => key !== 'source_id') ||
      typeof query.source_id !== 'string' || !query.source_id.trim() || query.source_id.length > 200) {
    throw new Error('invalid_processing_query')
  }
  return query.source_id.trim()
}
