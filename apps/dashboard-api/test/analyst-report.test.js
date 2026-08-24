import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { composeAnalystReport } from "../src/lib/chat/analyst-report.js";
import { buildPlan } from "../src/lib/chat/planner.js";

describe("composeAnalystReport", () => {
  it("includes findings and actions for analyst brief", () => {
    const brief = composeAnalystReport({
      intent: "optimize",
      minutes: 60,
      userMessage: "Phân tích vấn đề lớn nhất và nên làm gì?",
      data: {
        kpi: {
          unique_sessions: 10,
          total_events: 100,
          page_views: 50,
          product_views: 30,
          add_to_cart: 5,
          checkout_start: 2,
          purchases: 0,
          total_revenue: 0,
          conversion_rate: 0,
        },
        anomalies: [
          { product_id: "P001", product_name: "Áo", views: 20, severity_score: 22 },
        ],
      },
      ragHits: [],
      actions: [
        {
          priority: "high",
          title: "Fix P001",
          suggestion: "Cải thiện giá",
          confidence: 0.8,
        },
      ],
    });
    assert.match(brief, /PHÁT HIỆN/);
    assert.match(brief, /ƯU TIÊN HÀNH ĐỘNG/);
    assert.match(brief, /P001|Áo/);
  });

  it("planner routes analyze questions to deep tools", () => {
    const plan = buildPlan("Phân tích shop và ưu tiên vấn đề", { scope: { decision: "allow" } });
    assert.equal(plan.intent, "optimize");
    assert.ok(plan.tools.includes("fetchFunnel"));
    assert.ok(plan.tools.includes("fetchProductAnomalies"));
  });
});
