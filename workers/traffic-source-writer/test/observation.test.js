import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { INGRESS_EVENT_SPEC_VERSION } from '@3002tad/funnelmetry-input-contract'
import { extractTrafficSourceObservation } from '../src/observation.js'

const hash = value => createHash('sha256').update(value).digest('hex')
const event = {
  specversion: INGRESS_EVENT_SPEC_VERSION,
  source_id: 'medusa-reference', event_id: 'browser:event-1',
  producer: 'browser_sdk', source_event_type: 'behavior.page_viewed', source_schema_version: '1.0',
  occurred_at: '2026-10-12T00:00:00.000Z', source_payload: {},
  source_metadata: { utm_source: 'Facebook Ads/Partner', synthetic: false },
}
const raw = { ingestion_id: 'ing_feed_1', received_at: '2026-10-12T00:00:01.000Z', raw_body: JSON.stringify(event) }
const extract = (nextEvent = event, nextRaw = raw, key = [event.source_id, event.event_id]) =>
  extractTrafficSourceObservation({ key: JSON.stringify(key), value: JSON.stringify({ ...nextRaw, raw_body: JSON.stringify(nextEvent) }),
    rawRecordIdFallback: 'raw:0:1' })

test('keeps stable event identity, source version and exact UTM hash without storing the raw value', () => {
  const observation = extract()
  assert.equal(observation.source_event_id, event.event_id)
  assert.equal(observation.source_schema_version, '1.0')
  assert.equal(observation.received_at, raw.received_at)
  assert.equal(observation.utm_source_state, 'PRESENT')
  assert.equal(observation.utm_source_hash, hash('Facebook Ads/Partner'))
  assert.equal(observation.raw_content_hash, hash(raw.raw_body))
  assert.doesNotMatch(JSON.stringify(observation), /Facebook Ads|source_payload|anonymous_id/)
  assert.notEqual(observation.utm_source_hash, hash('facebook ads/partner'))
})

test('separates absent, empty-string, invalid and synthetic UTM metadata', () => {
  const absent = extract({ ...event, source_metadata: undefined })
  assert.equal(absent.utm_source_state, 'ABSENT')
  assert.equal(absent.utm_source_hash, null)
  const empty = extract({ ...event, source_metadata: { utm_source: '' } })
  assert.equal(empty.utm_source_state, 'PRESENT')
  assert.equal(empty.utm_source_hash, hash(''))
  const invalid = extract({ ...event, source_metadata: { utm_source: 123, synthetic: true } })
  assert.equal(invalid.utm_source_state, 'INVALID')
  assert.equal(invalid.utm_source_hash, null)
  assert.equal(invalid.synthetic, true)
})

test('non-browser facts are not projected into traffic observations', () => {
  assert.equal(extract({ ...event, producer: 'source_bridge', source_event_type: 'medusa.order_placed' }), null)
})

test('rejects mismatched identity, missing envelope fields and bad raw timestamps', () => {
  assert.throws(() => extract(event, raw, ['medusa-reference', 'browser:other']), /invalid_traffic_raw_record/)
  assert.throws(() => extract({ ...event, specversion: 'unsupported' }), /invalid_traffic_raw_record/)
  assert.throws(() => extract(event, { ...raw, received_at: 'no-date' }), /invalid_traffic_raw_record/)
})
