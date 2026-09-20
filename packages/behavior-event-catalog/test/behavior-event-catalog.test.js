import assert from "node:assert/strict"
import test from "node:test"
import {
  BEHAVIOR_EVENT_CATALOG_VERSION,
  BEHAVIOR_EVENT_TYPES,
  getBehaviorEventDefinition,
  validateBehaviorEvent,
} from "../src/index.js"

const pageInstanceId = "page:session-1:product-1"

const validPayloads = Object.freeze({
  "behavior.page_viewed": { page_type: "product", path_template: "/{countryCode}/products/{handle}", page_instance_id: pageInstanceId },
  "behavior.scroll_depth_reached": { page_type: "product", page_instance_id: pageInstanceId, depth_percent: 50 },
  "promotion.banner_impression": { banner_id: "hero_1", placement_id: "homepage_hero", page_instance_id: pageInstanceId, visible_percent: 50, visible_ms: 1000 },
  "promotion.banner_clicked": { banner_id: "hero_1", placement_id: "homepage_hero", page_instance_id: pageInstanceId, campaign_id: "spring_2026" },
  "behavior.search_submitted": { search_interaction_id: "search:interaction-1", query_normalized: "running shoes", outcome: "succeeded", result_count: 12 },
  "behavior.filter_applied": { page_instance_id: pageInstanceId, filter_keys: ["category", "size"], active_filter_count: 2 },
  "behavior.product_viewed": { product_id: "prod_1", page_instance_id: pageInstanceId, variant_id: "variant_1" },
  "checkout.started": { cart_id: "cart_1", step: "address", page_instance_id: pageInstanceId },
})

test("catalog validates every approved behavior event with its authority class", () => {
  assert.equal(BEHAVIOR_EVENT_TYPES.length, 8)
  for (const eventType of BEHAVIOR_EVENT_TYPES) {
    const result = validateBehaviorEvent(eventType, validPayloads[eventType])
    assert.equal(result.catalog_version, BEHAVIOR_EVENT_CATALOG_VERSION)
    assert.equal(result.event_type, eventType)
    assert.equal(result.event_class, getBehaviorEventDefinition(eventType).event_class)
  }
})

test("scroll accepts only configured milestones", () => {
  assert.throws(() => validateBehaviorEvent("behavior.scroll_depth_reached", {
    ...validPayloads["behavior.scroll_depth_reached"], depth_percent: 40,
  }), /depth_percent/)
})

test("banner impression requires the visibility and dwell thresholds", () => {
  assert.throws(() => validateBehaviorEvent("promotion.banner_impression", {
    ...validPayloads["promotion.banner_impression"], visible_percent: 49,
  }), /visible_percent/)
  assert.throws(() => validateBehaviorEvent("promotion.banner_impression", {
    ...validPayloads["promotion.banner_impression"], visible_ms: 999,
  }), /visible_ms/)
})

test("catalog rejects raw query, URL and unapproved payload fields", () => {
  assert.throws(() => validateBehaviorEvent("behavior.search_submitted", {
    ...validPayloads["behavior.search_submitted"], query: "running shoes",
  }), /privacy-restricted/)
  assert.throws(() => validateBehaviorEvent("behavior.page_viewed", {
    ...validPayloads["behavior.page_viewed"], page_url: "/gb/products/shirt?email=test@example.com",
  }), /privacy-restricted/)
  assert.throws(() => validateBehaviorEvent("behavior.product_viewed", {
    ...validPayloads["behavior.product_viewed"], name: "Medusa Sweatshirt",
  }), /unsupported field/)
})

test("search requires a normalized, sanitized query and authoritative outcome", () => {
  assert.throws(() => validateBehaviorEvent("behavior.search_submitted", {
    ...validPayloads["behavior.search_submitted"], query_normalized: "  Running   Shoes ",
  }), /normalized/)
  assert.throws(() => validateBehaviorEvent("behavior.search_submitted", {
    ...validPayloads["behavior.search_submitted"], query_normalized: "contact test@example.com",
  }), /email/)
  assert.throws(() => validateBehaviorEvent("behavior.search_submitted", {
    ...validPayloads["behavior.search_submitted"], outcome: "failed", result_count: 0,
  }), /result_count/)
  assert.deepEqual(validateBehaviorEvent("behavior.search_submitted", {
    search_interaction_id: "search:interaction-2", query_normalized: "running shoes", outcome: "failed",
  }).data, {
    search_interaction_id: "search:interaction-2", query_normalized: "running shoes", outcome: "failed",
  })
})

test("filter state keeps keys allowlisted and internally consistent", () => {
  assert.throws(() => validateBehaviorEvent("behavior.filter_applied", {
    ...validPayloads["behavior.filter_applied"], filter_keys: ["category", "category"],
  }), /duplicates/)
  assert.throws(() => validateBehaviorEvent("behavior.filter_applied", {
    ...validPayloads["behavior.filter_applied"], filter_keys: [], active_filter_count: 1,
  }), /identify active filters/)
})

test("unknown behavior event types cannot bypass the catalog", () => {
  assert.throws(() => validateBehaviorEvent("behavior.raw_dom_captured", {}), /Unsupported behavior event type/)
})
