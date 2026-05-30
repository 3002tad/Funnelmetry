import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "../src/lib/chat/planner.js";
import { classifyScope } from "../src/lib/chat/scope.guard.js";
import { extractMinutes, extractProductNameQuery, isGreetingMessage } from "../src/lib/chat/intent.js";
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

  it("extracts tuần qua as 7 days", () => {
    assert.equal(extractMinutes("trong tuần qua sản phẩm nào bán chạy"), 10080);
  });

  it("plans top products by purchases for week", () => {
    const plan = buildPlan("trong tuần qua sản phẩm nào được mua nhiều nhất", {
      scope: { decision: "allow", reason: "safe_analytics_request" },
    });
    assert.equal(plan.intent, "top_products");
    assert.equal(plan.minutes, 10080);
    assert.equal(plan.product_sort, "purchases");
    assert.ok(plan.tools.includes("fetchTopProducts"));
  });

  it("detects hello as greeting", () => {
    assert.equal(isGreetingMessage("hello"), true);
    assert.equal(isGreetingMessage("xin chào"), true);
    assert.equal(isGreetingMessage("doanh thu hello"), false);
  });

  it("plans greeting without analytics tools", () => {
    const plan = buildPlan("hello", { scope: { decision: "allow" } });
    assert.equal(plan.intent, "greeting");
    assert.equal(plan.tools.length, 0);
    assert.equal(plan.needs_rag, false);
  });

  it("plans help for capability questions (eval case)", () => {
    const scope = classifyScope("bạn làm được gì");
    assert.equal(scope.decision, "allow");
    const plan = buildPlan("bạn làm được gì", { scope });
    assert.equal(plan.intent, "help");
    assert.equal(plan.tools.length, 0);
  });

  it("plans product detail by name", () => {
    const msg = "mình hỏi chi tiết sản phẩm Hang chon loc Điện tử Modern 026";
    assert.equal(
      extractProductNameQuery(msg),
      "Hang chon loc Điện tử Modern 026"
    );
    const plan = buildPlan(msg, {
      scope: { decision: "allow", reason: "safe_analytics_request" },
    });
    assert.equal(plan.intent, "product_detail");
    assert.equal(plan.entities.product_name, "Hang chon loc Điện tử Modern 026");
    assert.ok(plan.tools.includes("fetchProductDetail"));
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
