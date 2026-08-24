import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateTrackingEvent } from "../src/tracking.validator.js";

const base = {
  anonymous_id: "anon_test",
  session_id: "sess_test",
  event_source: "browser_sdk",
};

describe("validateTrackingEvent", () => {
  it("accepts remove_from_cart with product_id", () => {
    const result = validateTrackingEvent({
      ...base,
      event_type: "remove_from_cart",
      event_category: "behavior",
      product_id: "P001",
      metadata: { quantity_before: 2, quantity_after: 1 },
    });
    assert.equal(result.ok, true);
    assert.equal(result.event.event_type, "remove_from_cart");
  });

  it("rejects unknown custom commerce types", () => {
    const result = validateTrackingEvent({
      ...base,
      event_type: "wishlist_add",
    });
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("unsupported event_type")));
  });
});
