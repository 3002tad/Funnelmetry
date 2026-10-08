// Strict allowlist for the internal connector snapshot. No raw response forwarding.
const sequence = value => Number.isSafeInteger(value) && value >= 0
const identifier = value => typeof value === 'string' && /^[\w.:-]{1,200}$/.test(value)

export function feedObservation(data) {
  const feed = data?.feed_observation
  if (!identifier(data?.connector_id) || !identifier(feed?.event_feed_id)
    || typeof feed.observed_at !== 'string' || !Number.isFinite(Date.parse(feed.observed_at))
    || ![feed.requested_after_seq, feed.retention_floor_seq, feed.latest_available_seq, feed.returned_count].every(sequence)
    || feed.retention_floor_seq > feed.requested_after_seq
    || feed.requested_after_seq > feed.latest_available_seq) return null
  return {
    connector_id: data.connector_id, event_feed_id: feed.event_feed_id,
    observed_at: new Date(feed.observed_at).toISOString(),
    requested_after_seq: String(feed.requested_after_seq),
    retention_floor_seq: String(feed.retention_floor_seq),
    latest_available_seq: String(feed.latest_available_seq),
    returned_count: feed.returned_count,
  }
}
