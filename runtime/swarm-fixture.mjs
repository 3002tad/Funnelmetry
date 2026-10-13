// Run only inside an isolated OFFLINE_DEMO worker container through stdin.
// This bypasses Source Connector and exercises the downstream Kafka path only.
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createKafkaPublisher } from '/workspace/workers/source-connector/src/kafka-publisher.js';

if (process.env.SWARM_FIXTURE_ACK !== 'OFFLINE_DEMO_SYNTHETIC'
  || process.env.SWARM_WAIT_ROLE !== 'worker' || !process.env.SWARM_EXPECTED_SCHEMA_DIGEST) {
  throw Error('Isolated Swarm worker required');
}
const require = createRequire('/workspace/workers/source-connector/package.json');
const { Kafka, logLevel } = require('kafkajs');
const suffix = randomUUID();
const feedId = randomUUID();
const anonymousId = `anonymous:${randomUUID()}`;
const sessionId = `session:${randomUUID()}`;
const cartId = `cart_smoke_${suffix}`;
const orderId = `order_smoke_${suffix}`;
const productId = `prod_smoke_${suffix}`;
const variantId = `variant_smoke_${suffix}`;
const lineItemId = `cali_smoke_${suffix}`;
const baseTime = Date.now() - 60_000;
const timestamp = index => new Date(baseTime + index * 1000).toISOString();
const common = { specversion: 'ingress-event.v1', source_id: 'medusa-reference',
  source_schema_version: '2.0', anonymous_id: anonymousId, session_id: sessionId };
const events = [
  { ...common, event_id: `browser:${randomUUID()}`, source_event_type: 'behavior.product_viewed',
    producer: 'browser_sdk', occurred_at: timestamp(0), correlation_id: sessionId,
    source_payload: { product_id: productId, page_instance_id: `page:${suffix}:product` },
    source_metadata: { utm_source: 'Local Swarm Smoke', synthetic: true } },
  { ...common, event_id: `medusa:cart.item_added:${cartId}:${lineItemId}:${suffix}`,
    source_event_type: 'cart.item_added', producer: 'source_bridge', occurred_at: timestamp(1),
    correlation_id: `cart:${cartId}`, aggregate: { type: 'cart', id: cartId },
    source_payload: { cart_id: cartId, line_item_id: lineItemId, variant_id: variantId,
      quantity: 1, product_id: productId } },
  { ...common, event_id: `browser:${randomUUID()}`, source_event_type: 'checkout.started',
    producer: 'browser_sdk', occurred_at: timestamp(2), correlation_id: `cart:${cartId}`,
    source_payload: { cart_id: cartId, step: 'address', page_instance_id: `page:${suffix}:checkout` },
    source_metadata: { utm_source: 'Local Swarm Smoke', synthetic: true } },
  { specversion: 'ingress-event.v1', source_id: 'medusa-reference',
    event_id: `medusa:order.placed:${orderId}`, source_event_type: 'medusa.order_placed',
    source_schema_version: '2.0', producer: 'source_bridge', occurred_at: timestamp(3),
    correlation_id: `cart:${cartId}`, aggregate: { type: 'order', id: orderId },
    source_payload: { order_id: orderId, cart_id: cartId, currency_code: 'eur',
      total_amount: '20', amount_unit: 'major', amount_semantics: 'medusa.order.total',
      items: [{ product_id: productId, variant_id: variantId, quantity: 1, unit_price_amount: '20' }] } },
];

const kafka = new Kafka({ clientId: `swarm-smoke-${suffix}`, brokers: ['kafka:9092'], logLevel: logLevel.ERROR });
const producer = kafka.producer({ idempotent: true, transactionalId: `swarm-smoke-${suffix}`,
  maxInFlightRequests: 1 });
await producer.connect();
try {
  const publish = createKafkaPublisher({ producer, rawTopic: 'funnelmetry.raw.v1',
    receiptTopic: 'funnelmetry.ingress.receipts.v1' });
  for (const [index, event] of events.entries()) {
    const receivedAt = timestamp(index + 4);
    await publish({ key: JSON.stringify([event.source_id, event.event_id]),
      value: JSON.stringify({ ingestion_id: `swarm-smoke-${suffix}-${index + 1}`,
        received_at: receivedAt, raw_body: JSON.stringify(event),
        event_feed_id: feedId, ingress_seq: index + 1, source_accepted_at: receivedAt }) });
  }
  console.log(`PASS synthetic handoff: four events, run=${suffix}, cart=${cartId}, order=${orderId}`);
} finally { await producer.disconnect(); }
