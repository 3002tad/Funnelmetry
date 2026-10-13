// One read-only PostgreSQL snapshot. No raw body, source payload, credential or Docker state.
export const EVENT_TRACE_SQL = `WITH outcome AS (
  SELECT status, canonical_event_id, reason_code, mapping_version, raw_record_id, processed_at
  FROM canonicalization_latest_outcomes
  WHERE source_id=$1 AND source_event_id=$2
), canonical AS (
  SELECT c.canonical_event_id, c.event_type, c.event_class, c.raw_record_id,
         c.occurred_at, c.persisted_at
  FROM canonical_events c JOIN outcome o ON c.canonical_event_id=o.canonical_event_id
)
SELECT
  (SELECT row_to_json(r) FROM (
    SELECT ingestion_id, received_at, recorded_at FROM ingress_accepted_receipts
    WHERE source_id=$1 AND event_id=$2
  ) r) AS receipt,
  (SELECT row_to_json(o) FROM outcome o) AS outcome,
  (SELECT row_to_json(c) FROM canonical c) AS canonical,
  (SELECT row_to_json(j) FROM (
    SELECT je.journey_id, je.link_confidence, je.linked_at
    FROM journey_events je JOIN canonical c USING (canonical_event_id)
  ) j) AS journey,
  (SELECT coalesce(json_agg(row_to_json(f)), '[]'::json) FROM (
    SELECT fa.funnel_profile_id, fa.profile_version, fa.application_status, fa.applied_at
    FROM funnel_event_applications fa JOIN canonical c USING (canonical_event_id)
    ORDER BY fa.funnel_profile_id, fa.profile_version
  ) f) AS funnel_applications,
  (SELECT row_to_json(k) FROM (
    SELECT ka.changed_instance_count, ka.applied_at
    FROM kpi_projection_applications ka JOIN canonical c ON ka.trigger_event_id=c.canonical_event_id
  ) k) AS kpi_application`;

export function parseEventTraceQuery(input) {
  if (Object.keys(input).some(key => !['source_id', 'event_id'].includes(key))) throw Error('invalid_event_trace_query');
  const sourceId = input.source_id;
  const eventId = input.event_id;
  if (typeof sourceId !== 'string' || !sourceId.trim() || sourceId.length > 200 ||
      typeof eventId !== 'string' || !eventId.trim() || eventId.length > 512 ||
      /[\x00-\x1f\x7f]/.test(sourceId + eventId)) throw Error('invalid_event_trace_query');
  return { sourceId: sourceId.trim(), eventId: eventId.trim() };
}

export function summarizeEventTrace(row) {
  const pick = (value, keys) => value ? Object.fromEntries(keys.map(key => [key, value[key] ?? null])) : null;
  const receipt = pick(row.receipt, ['ingestion_id', 'received_at', 'recorded_at']);
  const outcome = pick(row.outcome, ['status', 'canonical_event_id', 'reason_code', 'mapping_version', 'raw_record_id', 'processed_at']);
  const canonical = pick(row.canonical, ['canonical_event_id', 'event_type', 'event_class', 'raw_record_id', 'occurred_at', 'persisted_at']);
  const journey = pick(row.journey, ['journey_id', 'link_confidence', 'linked_at']);
  const mismatch = Boolean(
    (receipt && outcome && receipt.ingestion_id !== outcome.raw_record_id) ||
    (receipt && canonical && receipt.ingestion_id !== canonical.raw_record_id) ||
    (outcome?.status === 'normalized' && canonical && outcome.canonical_event_id !== canonical.canonical_event_id));
  const state = mismatch ? 'INCONSISTENT'
    : !receipt ? 'NO_RECEIPT_OBSERVED'
      : !outcome ? 'WAITING_FOR_OUTCOME'
        : outcome.status !== 'normalized' ? 'TERMINAL_NON_NORMALIZED'
          : !canonical ? 'WAITING_FOR_LEDGER'
            : !journey ? 'WAITING_FOR_JOURNEY'
              : 'CANONICAL_JOURNEY_OBSERVED';
  return { state, receipt, outcome, canonical, journey,
    funnel_applications: Array.isArray(row.funnel_applications) ? row.funnel_applications.map(item =>
      pick(item, ['funnel_profile_id', 'profile_version', 'application_status', 'applied_at'])) : [],
    kpi_application: pick(row.kpi_application, ['changed_instance_count', 'applied_at']),
    scope: 'retained_postgres_records', source_feed_verified: false,
    kafka_ack_verified: false, processing_safe_checkpoint_verified: false };
}
