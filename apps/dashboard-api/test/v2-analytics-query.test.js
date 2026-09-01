import test from "node:test"
import assert from "node:assert/strict"
import { parseEventFilters, parseJourneyId, parseListLimit, parseProfileIdentity, parseV2AnalyticsQuery } from "../src/lib/v2-analytics-query.js"
import { isShopApiPath } from "../src/lib/api-zones.js"

test("parses a source-scoped entry cohort", () => {
  const value = parseV2AnalyticsQuery({
    source_id: "medusa-reference",
    from: "2026-08-01T00:00:00Z",
    to: "2026-09-01T00:00:00Z",
  })
  assert.equal(value.sourceId, "medusa-reference")
  assert.equal(value.from, "2026-08-01T00:00:00.000Z")
})

test("rejects missing source scope and reversed cohort bounds", () => {
  assert.throws(() => parseV2AnalyticsQuery({}), /source_id/)
  assert.throws(() => parseV2AnalyticsQuery({
    source_id: "medusa-reference", from: "2026-09-01T00:00:00Z", to: "2026-08-01T00:00:00Z",
  }), /earlier/)
})

test("validates profile, journey and bounded list inputs", () => {
  assert.deepEqual(parseProfileIdentity("commerce-conversion", "1.0.0"), {
    profileId: "commerce-conversion", version: "1.0.0",
  })
  assert.equal(parseJourneyId("journey_abc-123"), "journey_abc-123")
  assert.equal(parseListLimit("500"), 100)
  assert.throws(() => parseListLimit("none"), /positive integer/)
})

test("protects V2 analytics endpoints with the existing shop role zone", () => {
  assert.equal(isShopApiPath("/api/v2/analytics/overview"), true)
  assert.equal(isShopApiPath("/api/v2/analytics/journeys/journey_1"), true)
})

test("validates canonical event filters without accepting arbitrary SQL-shaped values", () => {
  assert.deepEqual(parseEventFilters({ event_class: "business_fact", event_type: "order.accepted", limit: "250" }), {
    eventClass: "BUSINESS_FACT", eventType: "order.accepted", limit: 200,
  })
  assert.throws(() => parseEventFilters({ event_class: "UNKNOWN" }), /event_class/)
  assert.throws(() => parseEventFilters({ event_type: "order.accepted' OR 1=1" }), /event_type/)
})
