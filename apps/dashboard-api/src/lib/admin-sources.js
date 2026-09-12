export function parseSourcesQuery(query) {
  if (Object.keys(query).some(key => !['limit', 'after', 'source_id'].includes(key))) throw Error('unknown_filter')
  const limit = query.limit === undefined ? 25 : Number(query.limit)
  if ((query.limit !== undefined && (typeof query.limit !== 'string' || !/^\d+$/.test(query.limit)))
    || !Number.isInteger(limit) || limit < 1 || limit > 100) throw Error('invalid_limit')
  for (const key of ['after', 'source_id']) {
    if (query[key] !== undefined && (typeof query[key] !== 'string' || !query[key].trim()
      || query[key].length > 200 || /[\x00-\x1f\x7f]/.test(query[key]))) throw Error(`invalid_${key}`)
  }
  return { limit, after: query.after ?? null, source_id: query.source_id ?? null }
}

export async function listObservedSources(execute, filters) {
  // Evidence inventory only: neither receipts nor claims are a configuration registry or heartbeat.
  const rows = await execute(`WITH sources AS (
    SELECT source_id FROM ingress_accepted_receipts
    UNION SELECT source_id FROM ingress_receipt_claims
    UNION SELECT source_id FROM canonical_events
    UNION SELECT source_id FROM canonicalization_outcomes
  ), page AS (
    SELECT source_id FROM sources
    WHERE ($1::text IS NULL OR source_id COLLATE "C" > $1::text COLLATE "C")
      AND ($2::text IS NULL OR source_id=$2)
    ORDER BY source_id COLLATE "C" LIMIT $3
  ) SELECT p.source_id,
    (SELECT COUNT(*)::text FROM ingress_accepted_receipts r WHERE r.source_id=p.source_id) AS accepted_receipts,
    (SELECT MAX(received_at) FROM ingress_accepted_receipts r WHERE r.source_id=p.source_id) AS last_received_at,
    (SELECT COUNT(*)::text FROM ingress_receipt_claims c WHERE c.source_id=p.source_id AND c.claim_state='CLAIMED') AS pending_claims,
    (SELECT COUNT(*)::text FROM canonical_events e WHERE e.source_id=p.source_id) AS canonical_events,
    (SELECT MAX(persisted_at) FROM canonical_events e WHERE e.source_id=p.source_id) AS last_canonical_at,
    (SELECT COUNT(*)::text FROM canonicalization_latest_outcomes o WHERE o.source_id=p.source_id AND o.status='quarantined') AS quarantined_outcomes,
    (SELECT COUNT(*)::text FROM canonicalization_latest_outcomes o WHERE o.source_id=p.source_id AND o.status='unsupported') AS unsupported_outcomes
    FROM page p ORDER BY p.source_id COLLATE "C"`, [filters.after, filters.source_id, filters.limit + 1])
  const items = rows.slice(0, filters.limit).map(row => ({ ...row, connection_status: 'UNVERIFIED' }))
  return {
    items, limit: filters.limit, next_after: rows.length > filters.limit ? items.at(-1).source_id : null,
    checked_at: new Date().toISOString(), evidence: 'postgres_v2', scope: 'retained_observed_sources',
    unavailable: ['Configured sources without retained evidence', 'Connector/Relay liveness', 'Private ingress connectivity'],
  }
}
