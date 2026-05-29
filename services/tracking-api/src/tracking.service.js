import { randomUUID } from "node:crypto";
import { getProducer } from "./kafka.producer.js";

function newEventId() {
  return `evt_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

export function enrichEvent(raw) {
  const event = { ...raw };
  if (!event.event_id) event.event_id = newEventId();
  if (!event.timestamp) event.timestamp = new Date().toISOString();
  if (!event.event_source) event.event_source = "browser_sdk";
  if (!event.timestamp && event.occurred_at) event.timestamp = event.occurred_at;
  const commerceSources = new Set([
    "commerce_backend_rabbitmq",
    "web_demo_backend",
    "web_demo_worker",
    "web_demo_api",
    "rabbitmq_adapter",
  ]);
  if (!event.event_category) {
    event.event_category = commerceSources.has(event.event_source) ? "commerce" : "behavior";
  }
  if (event.metadata == null) event.metadata = {};
  return event;
}

export async function ingestOne(raw) {
  const event = enrichEvent(raw);
  const producer = await getProducer();
  await producer.send({
    key: event.session_id,
    value: JSON.stringify(event),
  });
  return event;
}

export async function ingestBatch(events) {
  const enriched = events.map(enrichEvent);
  const producer = await getProducer();
  await producer.sendBatch(
    enriched.map((event) => ({
      key: event.session_id,
      value: JSON.stringify(event),
    }))
  );
  return enriched;
}
