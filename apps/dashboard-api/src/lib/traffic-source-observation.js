// One event at raw-acquisition grain. Never select or return the UTM value/hash.
export const TRAFFIC_SOURCE_INPUT_SQL = `SELECT source_event_type, source_schema_version,
  raw_record_id, received_at, recorded_at, utm_source_state, synthetic
  FROM traffic_source_raw_events_v1
  WHERE source_id=$1 AND source_event_id=$2`;

export function summarizeTrafficSourceInput(row) {
  if (!row) return {
    state: 'NOT_OBSERVED', source_event_type: null, source_schema_version: null,
    raw_record_id: null, received_at: null, recorded_at: null, synthetic: null,
  };
  if (!['PRESENT', 'ABSENT', 'INVALID'].includes(row.utm_source_state)) {
    throw Error('invalid_traffic_source_input_state');
  }
  return {
    state: row.utm_source_state,
    source_event_type: row.source_event_type,
    source_schema_version: row.source_schema_version,
    raw_record_id: row.raw_record_id,
    received_at: row.received_at,
    recorded_at: row.recorded_at,
    synthetic: row.synthetic,
  };
}
