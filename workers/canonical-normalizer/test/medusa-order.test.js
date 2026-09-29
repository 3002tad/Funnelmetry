import test from 'node:test'
import assert from 'node:assert/strict'
import { validateMedusaOrder } from '../src/medusa-order.js'
import { createNormalizer } from '../src/normalizer.js'
import { loadMappingRegistry } from '../src/mapping-loader.js'
import { extractJourneyEvidence } from '../../journey-processor/src/evidence.js'

const event = {
  specversion: 'ingress-event.v1', source_id: 'medusa-reference', event_id: 'medusa:order.placed:order_1',
  source_event_type: 'medusa.order_placed', source_schema_version: '2.0', producer: 'source_bridge',
  occurred_at: '2026-09-22T12:45:54.473Z', correlation_id: 'cart:cart_1', aggregate: { type: 'order', id: 'order_1' },
  source_payload: { order_id: 'order_1', cart_id: 'cart_1', total_amount: '20', currency_code: 'eur', amount_unit: 'major', amount_semantics: 'medusa.order.total',
    items: [{ product_id: 'prod_1', variant_id: 'variant_1', quantity: 1, unit_price_amount: '10' }] },
}
test('Medusa v2 keeps decimal money and cart evidence, with stable duplicate identity', async () => {
  const registry = await loadMappingRegistry(new URL('../../../integrations/medusa/canonical-mappings.v1.json', import.meta.url))
  const normalize = input => createNormalizer({ registry }).normalize({ key: JSON.stringify([input.source_id, input.event_id]), value: JSON.stringify({ ingestion_id: 'raw_1', received_at: input.occurred_at, raw_body: JSON.stringify(input) }) })
  const a = normalize(event), b = normalize(event)
  assert.equal(a.status, 'normalized')
  assert.equal(a.canonicalEvent.event_type, 'order.placed')
  assert.equal(a.canonicalEvent.canonical_event_id, b.canonicalEvent.canonical_event_id)
  assert.equal(a.canonicalEvent.data.total_amount, '20')
  assert.equal(a.canonicalEvent.relations.cart_id, 'cart_1')
  assert.equal(a.canonicalEvent.relations.order_id, 'order_1')
  assert.ok(extractJourneyEvidence(a.canonicalEvent).some(item => item.entity_type === 'CART' && item.entity_key === 'cart_1' && item.link_method === 'BUSINESS_ENTITY' && item.link_confidence === 'STRONG'))
  assert.ok(extractJourneyEvidence(a.canonicalEvent).some(item => item.entity_key === 'cart:cart_1' && item.link_confidence === 'STRONG'))
  assert.equal(normalize({ ...event, source_schema_version: '1.0' }).status, 'unsupported')
  assert.equal(normalize({ ...event, producer: 'browser_sdk' }).status, 'quarantined')
})
test('invalid amount, unit, correlation and false authority fail closed', () => {
  for (const patch of [{ total_amount: 20 }, { total_amount: 'NaN' }, { amount_unit: 'minor' }, { total_minor: 2000 }, { currency_code: '' }, { order_id: '' }]) {
    assert.throws(() => validateMedusaOrder({ ...event, source_payload: { ...event.source_payload, ...patch } }))
  }
  assert.throws(() => validateMedusaOrder({ ...event, correlation_id: 'unrelated' }))
  assert.throws(() => validateMedusaOrder({ ...event, occurred_at: undefined }))
})
