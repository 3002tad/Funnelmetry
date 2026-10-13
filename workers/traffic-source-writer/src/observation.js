import { createHash } from 'node:crypto'
import { validateIngressEvent } from '@3002tad/funnelmetry-input-contract'

const hash = value => createHash('sha256').update(value).digest('hex')

export function extractTrafficSourceObservation({ key, value, rawRecordIdFallback }) {
  let identity, raw, event
  try {
    identity = JSON.parse(Buffer.isBuffer(key) ? key.toString('utf8') : String(key))
    raw = JSON.parse(Buffer.isBuffer(value) ? value.toString('utf8') : String(value))
    if (!Array.isArray(identity) || identity.length !== 2 || identity.some(value => typeof value !== 'string' || !value)) {
      throw new Error('invalid key')
    }
    if (!raw || typeof raw.raw_body !== 'string' || typeof raw.received_at !== 'string'
      || !Number.isFinite(Date.parse(raw.received_at))) throw new Error('invalid raw record')
    event = validateIngressEvent(JSON.parse(raw.raw_body), { requireOccurredAt: false })
    if (identity[0] !== event.source_id || identity[1] !== event.event_id) throw new Error('key mismatch')
  } catch {
    // This independent projection fails closed; the canonical normalizer owns
    // quarantine decisions and must not be silently bypassed here.
    throw new Error('invalid_traffic_raw_record')
  }
  if (event.producer !== 'browser_sdk') return null
  const metadata = event.source_metadata
  const hasUtm = metadata && Object.hasOwn(metadata, 'utm_source')
  const state = !hasUtm ? 'ABSENT' : typeof metadata.utm_source === 'string' ? 'PRESENT' : 'INVALID'
  return Object.freeze({
    source_id: event.source_id,
    source_event_id: event.event_id,
    source_event_type: event.source_event_type,
    source_schema_version: event.source_schema_version,
    raw_record_id: typeof raw.ingestion_id === 'string' && raw.ingestion_id ? raw.ingestion_id : rawRecordIdFallback,
    raw_content_hash: hash(raw.raw_body),
    received_at: raw.received_at,
    utm_source_state: state,
    utm_source_hash: state === 'PRESENT' ? hash(metadata.utm_source) : null,
    synthetic: metadata?.synthetic === true,
  })
}
