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
    assert.equal(plan.minutes, 120);
    assert.ok(plan.tools.includes("fetchKpiComparison"));
  });

  it("routes explain view-many buy-few to product_anomaly with top products tools", () => {
    const plan = buildPlan("giải thích tại sao lại đc xem nhiều nhưng lại mua ít", {
      scope: { decision: "allow", reason: "safe_analytics_request" },
      memory: { last_intent: "top_products", last_minutes: 43200, last_product_sort: "views" },
    });
    assert.equal(plan.intent, "product_anomaly");
    assert.equal(plan.minutes, 43200);
    assert.ok(plan.tools.includes("fetchProductAnomalies"));
    assert.ok(plan.tools.includes("fetchTopProducts"));
    assert.equal(plan.tools.includes("fetchFunnel"), false);
  });

  it("keeps product_anomaly for trong 1 tháng thì sao follow-up", () => {
    const plan = buildPlan("trong 1 tháng thì sao", {
      scope: { decision: "allow", reason: "safe_analytics_request" },
      memory: { last_intent: "product_anomaly", last_minutes: 60 },
    });
    assert.equal(plan.intent, "product_anomaly");
    assert.equal(plan.minutes, 43200);
    assert.ok(plan.tools.includes("fetchProductAnomalies"));
  });

  it("parses 2 giờ này as 120 minutes even with memory at 30 days", () => {
    assert.equal(extractMinutes("So sánh 2 giờ này với 2 giờ trước", 43200), 120);
    const plan = buildPlan("So sánh 2 giờ này với 2 giờ trước", {
      scope: { decision: "allow", reason: "safe_analytics_request" },
      memory: { last_intent: "revenue", last_minutes: 43200 },
    });
    assert.equal(plan.intent, "comparison");
    assert.equal(plan.minutes, 120);
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

  it("routes order follow-up to recent_purchases with memory window", () => {
    const plan = buildPlan("trong các đơn đó đơn nào cao nhất", {
      scope: { decision: "allow", reason: "safe_analytics_request" },
      memory: { last_intent: "orders", last_minutes: 43200 },
    });
    assert.equal(plan.intent, "recent_purchases");
    assert.equal(plan.minutes, 43200);
    assert.ok(plan.tools.includes("fetchRecentPurchases"));
  });

  it("blocks product_detail when asking about order items", () => {
    const plan = buildPlan("đơn đó có sản phẩm nào", {
      scope: { decision: "allow", reason: "safe_analytics_request" },
      memory: { last_intent: "orders", last_minutes: 1440 },
    });
    assert.equal(plan.intent, "recent_purchases");
  });

  it("plans tháng hiện tại as revenue with 30-day window", () => {
    const plan = buildPlan("doanh thu trong tháng hiện tại như thế nào", {
      scope: { decision: "allow", reason: "safe_analytics_request" },
    });
    assert.equal(plan.intent, "revenue");
    assert.equal(plan.minutes, 43200);
    assert.ok(plan.tools.includes("fetchOverview"));
  });

  it("keeps revenue for phân tích doanh thu 1 tháng qua (not optimize)", () => {
    const plan = buildPlan("phân tích doanh thu trong 1 tháng qua", {
      scope: { decision: "allow", reason: "safe_analytics_request" },
    });
    assert.equal(plan.intent, "revenue");
    assert.equal(plan.minutes, 43200);
    assert.ok(plan.tools.includes("fetchOverview"));
    assert.equal(plan.tools.includes("fetchProductAnomalies"), false);
    assert.equal(plan.tools.includes("fetchBanners"), false);
  });

  it("parses trong 1 tuần as 10080 minutes for top products", () => {
    assert.equal(extractMinutes("sản phẩm nào bán nhiều nhất trong 1 tuần"), 10080);
    const plan = buildPlan("sản phẩm nào bán nhiều nhất trong 1 tuần", {
      scope: { decision: "allow", reason: "safe_analytics_request" },
    });
    assert.equal(plan.intent, "top_products");
    assert.equal(plan.minutes, 10080);
    assert.equal(plan.product_sort, "purchases");
  });

  it("defaults top_products by purchases to 7 days without explicit time", () => {
    const plan = buildPlan("sản phẩm nào đc mua nhiều nhất", {
      scope: { decision: "allow", reason: "safe_analytics_request" },
    });
    assert.equal(plan.intent, "top_products");
    assert.equal(plan.product_sort, "purchases");
    assert.equal(plan.minutes, 10080);
  });

  it("plans tháng này as 43200 minutes for revenue", () => {
    const plan = buildPlan("thu nhập tháng này", {
      scope: { decision: "allow", reason: "safe_analytics_request" },
    });
    assert.equal(plan.intent, "revenue");
    assert.equal(plan.minutes, 43200);
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
