export const browserEvent = Object.freeze({
  specversion: "ingress-event.v1",
  source_id: "medusa-reference",
  event_id: "browser:evt-123",
  source_event_type: "behavior.product_viewed",
  source_schema_version: "1.0",
  occurred_at: "2026-09-11T00:00:00.000Z",
  producer: "browser_sdk",
  source_payload: { product_id: "prod_1" },
})

export function browserKeys() {
  return {
    "relay-browser": {
      source_id: "medusa-reference",
      secret: "relay-secret",
      allowed_origins: ["https://shop.example.test"],
    },
  }
}

export function metrics() {
  return { increment: () => {}, render: () => "" }
}
