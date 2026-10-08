import { createHash } from 'node:crypto'
import { validateIngressEvent } from '@3002tad/funnelmetry-input-contract'

export class ConnectorError extends Error {
  constructor(code) { super(code); this.code = code }
}

function requireCondition(condition, code = 'INVALID_FEED') {
  if (!condition) throw new ConnectorError(code)
}

function sequence(value) {
  return Number.isSafeInteger(value) && value >= 0
}

export function validateCursor(cursor) {
  requireCondition(cursor && typeof cursor.event_feed_id === 'string' && cursor.event_feed_id.length > 0
    && sequence(cursor.after_seq), 'INVALID_CURSOR')
  return cursor
}

// Validate the entire batch before any side effect. Never skip malformed records.
export function validateFeed(feed, cursor, limit) {
  validateCursor(cursor)
  requireCondition(feed && feed.event_feed_id === cursor.event_feed_id, 'FEED_ID_MISMATCH')
  requireCondition(sequence(feed.retention_floor_seq) && sequence(feed.latest_available_seq))
  requireCondition(cursor.after_seq >= feed.retention_floor_seq, 'RETENTION_GAP')
  requireCondition(feed.latest_available_seq >= cursor.after_seq, 'FEED_REGRESSION')
  requireCondition(Array.isArray(feed.events) && feed.events.length <= limit)
  let previous = cursor.after_seq
  for (const record of feed.events) {
    requireCondition(record && record.event_feed_id === cursor.event_feed_id, 'FEED_ID_MISMATCH')
    requireCondition(sequence(record.ingress_seq) && record.ingress_seq > previous
      && record.ingress_seq <= feed.latest_available_seq)
    requireCondition(typeof record.accepted_at === 'string' && Number.isFinite(Date.parse(record.accepted_at)))
    try { validateIngressEvent(record) } catch { throw new ConnectorError('INVALID_SOURCE_EVENT') }
    previous = record.ingress_seq
  }
  requireCondition(feed.next_after_seq === previous)
  return feed.events
}

export function toRawMessage(record, receivedAt) {
  const event = validateIngressEvent(record)
  const ingestionId = 'ing_feed_' + createHash('sha256')
    .update(JSON.stringify([record.event_feed_id, record.ingress_seq])).digest('hex')
  return {
    key: JSON.stringify([event.source_id, event.event_id]),
    value: JSON.stringify({
      ingestion_id: ingestionId,
      received_at: receivedAt,
      raw_body: JSON.stringify(event),
      event_feed_id: record.event_feed_id,
      ingress_seq: record.ingress_seq,
      source_accepted_at: record.accepted_at,
    }),
  }
}

// Single-flight, ordered publishing deliberately prevents out-of-order ACK holes.
// cursorStore must be durable and compare-and-set; publisher resolves only on broker ACK.
export function createConnector({ feedClient, cursorStore, publish, limit = 100, now = () => new Date().toISOString(), onFeedValidated = () => {} }) {
  requireCondition(Number.isSafeInteger(limit) && limit > 0, 'INVALID_LIMIT')
  let busy = false
  return {
    async pollOnce() {
      requireCondition(!busy, 'POLL_ALREADY_RUNNING')
      busy = true
      try {
        let cursor = { ...validateCursor(await cursorStore.load()) }
        const feed = await feedClient.read({ ...cursor, limit })
        const records = validateFeed(feed, cursor, limit)
        // Observation only: this is BEFORE publishing, not a processing checkpoint.
        // Never pass event payloads or credentials to the monitoring surface.
        onFeedValidated(Object.freeze({
          observed_at: now(), event_feed_id: cursor.event_feed_id,
          requested_after_seq: cursor.after_seq,
          retention_floor_seq: feed.retention_floor_seq,
          latest_available_seq: feed.latest_available_seq,
          returned_count: records.length,
        }))
        for (const record of records) {
          await cursorStore.assertOwned?.()
          await publish(toRawMessage(record, now()))
          const next = { event_feed_id: cursor.event_feed_id, after_seq: record.ingress_seq }
          // If persistence fails, stop. A restart may republish, never skip the record.
          await cursorStore.advance(cursor, next)
          cursor = next
        }
        return { count: records.length, cursor }
      } finally { busy = false }
    },
  }
}
