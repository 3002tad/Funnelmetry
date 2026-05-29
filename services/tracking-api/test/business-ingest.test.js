import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { businessEventToTracking } from "../src/lib/business-event.mapper.js";
import { validateBusinessBatch } from "../src/lib/business-event.validator.js";
import { markSeen, resetDedupForTests } from "../src/lib/business-event.dedup.js";

describe("business ingest", () => {
  it("maps order.completed to purchase_succeeded", () => {
    const mapped = businessEventToTracking({
      event_id: "e1",
      event_type: "order.completed",
      event_source: "web_demo_worker",
      occurred_at: "2026-05-29T10:00:00.000Z",
      session_id: "s1",
      order_id: "ORDER-1",
      metadata: { total_amount: 100 },
    });
    assert.equal(mapped.event_type, "purchase_succeeded");
    assert.equal(mapped.event_source, "rabbitmq_adapter");
  });

  it("validates batch payload", () => {
    const r = validateBusinessBatch({
      tenant_id: "demo",
      source: "adapter",
      events: [{
        event_id: "e2",
        event_type: "order.created",
        event_source: "web_demo_api",
        occurred_at: "2026-05-29T10:00:00.000Z",
        session_id: "s1",
        order_id: "ORDER-2",
        metadata: {},
      }],
    });
    assert.equal(r.ok, true);
  });

  it("deduplicates event_id", () => {
    resetDedupForTests();
    assert.equal(markSeen("dup-1"), false);
    assert.equal(markSeen("dup-1"), true);
  });
});
