import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "../src/lib/chat/planner.js";
import { classifyScope } from "../src/lib/chat/scope.guard.js";
import { extractMinutes } from "../src/lib/chat/intent.js";
import { buildActionCards } from "../src/lib/chat/action.engine.js";

describe("buildPlan", () => {
  it("plans comparison tools", () => {
    const plan = buildPlan("So sánh 2 giờ gần nhất với 2 giờ trước", {
      scope: { decision: "allow", reason: "safe_analytics_request" },
    });
    assert.equal(plan.intent, "comparison");
    assert.ok(plan.tools.includes("fetchKpiComparison"));
  });

  it("uses memory for follow-up", () => {
    const plan = buildPlan("Thế còn sao?", {
      scope: { decision: "allow" },
      memory: { last_intent: "revenue", last_minutes: 120 },
    });
    assert.equal(plan.intent, "revenue");
    assert.ok(plan.from_memory);
  });

  it("extracts hôm nay as 1440 minutes", () => {
    assert.equal(extractMinutes("Doanh thu hôm nay"), 1440);
  });
});

describe("buildActionCards", () => {
  it("creates product anomaly card", () => {
    const cards = buildActionCards({
      intent: "product_anomaly",
      data: {
        anomalies: [{ product_id: "P001", product_name: "Áo", views: 20, severity_score: 22 }],
      },
      minutes: 60,
    });
    assert.ok(cards.length >= 1);
    assert.equal(cards[0].priority, "high");
  });
});
