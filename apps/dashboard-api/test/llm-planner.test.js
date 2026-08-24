import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseLlmPlanResponse, normalizeLlmSlots } from "../src/lib/chat/llm-planner.js";
import { applyLlmSlots, buildPlan } from "../src/lib/chat/planner.js";

describe("parseLlmPlanResponse", () => {
  it("parses bare JSON", () => {
    const parsed = parseLlmPlanResponse('{"intent":"revenue","minutes":1440,"product_sort":null,"is_followup":false}');
    assert.equal(parsed.intent, "revenue");
  });

  it("parses fenced JSON", () => {
    const parsed = parseLlmPlanResponse(
      '```json\n{"intent":"top_products","minutes":10080,"product_sort":"purchases","is_followup":false}\n```'
    );
    assert.equal(parsed.intent, "top_products");
  });
});

describe("normalizeLlmSlots", () => {
  it("rejects invalid intent", () => {
    assert.equal(normalizeLlmSlots({ intent: "hack_db", minutes: 60 }), null);
  });

  it("nulls invalid minutes", () => {
    const slots = normalizeLlmSlots({ intent: "revenue", minutes: 999999, is_followup: false });
    assert.equal(slots.minutes, null);
    assert.equal(slots.intent, "revenue");
  });
});

describe("applyLlmSlots", () => {
  it("upgrades general to LLM intent", () => {
    const rulePlan = buildPlan("hàng hot dạo này", {
      scope: { decision: "allow" },
    });
    const merged = applyLlmSlots(
      rulePlan,
      { intent: "top_products", minutes: 10080, product_sort: "purchases", is_followup: false },
      "hàng hot dạo này",
      null
    );
    assert.equal(merged.intent, "top_products");
    assert.equal(merged.product_sort, "purchases");
    assert.ok(merged.tools.includes("fetchTopProducts"));
  });

  it("uses memory on follow-up", () => {
    const rulePlan = buildPlan("còn hôm qua", {
      scope: { decision: "allow" },
      memory: { last_intent: "revenue", last_minutes: 60 },
    });
    const merged = applyLlmSlots(
      rulePlan,
      { intent: "general", minutes: 1440, product_sort: null, is_followup: true },
      "còn hôm qua",
      { last_intent: "revenue", last_minutes: 60 }
    );
    assert.equal(merged.intent, "revenue");
    assert.equal(merged.minutes, 1440);
  });
});
