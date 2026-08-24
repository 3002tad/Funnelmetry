import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { splitCompoundClauses, isCompoundCandidate } from "../src/lib/chat/compound.js";
import { buildPlan } from "../src/lib/chat/planner.js";
import { classifyScope } from "../src/lib/chat/scope.guard.js";

describe("splitCompoundClauses", () => {
  it("splits on và", () => {
    const parts = splitCompoundClauses("Doanh thu hôm nay và top sản phẩm bán chạy?");
    assert.deepEqual(parts, ["Doanh thu hôm nay", "top sản phẩm bán chạy?"]);
  });

  it("ignores deep analysis prompts", () => {
    assert.equal(splitCompoundClauses("Phân tích shop hôm nay và funnel"), null);
  });

  it("ignores short follow-ups", () => {
    assert.equal(splitCompoundClauses("Thế còn sao?"), null);
  });
});

describe("buildPlan compound", () => {
  it("merges revenue + top_products", () => {
    const msg = "Doanh thu hôm nay và top sản phẩm bán chạy?";
    const plan = buildPlan(msg, { scope: classifyScope(msg) });
    assert.equal(plan.intent, "compound");
    assert.ok(plan.tools.includes("fetchOverview"));
    assert.ok(plan.tools.includes("fetchTopProducts"));
    assert.equal(plan.sub_intents.length, 2);
    assert.ok(plan.sub_intents.some((s) => s.intent === "revenue"));
    assert.ok(plan.sub_intents.some((s) => s.intent === "top_products"));
  });

  it("merges comparison + top_products", () => {
    const msg = "So sánh doanh thu tuần trước, top 5 sản phẩm bán chạy";
    const plan = buildPlan(msg, { scope: classifyScope(msg) });
    assert.equal(plan.intent, "compound");
    assert.ok(plan.tools.includes("fetchKpiComparison"));
    assert.ok(plan.tools.includes("fetchTopProducts"));
  });

  it("does not compound single-intent duplicates", () => {
    const msg = "Doanh thu hôm nay và doanh thu tuần qua";
    const plan = buildPlan(msg, { scope: classifyScope(msg) });
    assert.notEqual(plan.intent, "compound");
  });
});

describe("isCompoundCandidate", () => {
  it("detects analytics compound", () => {
    assert.equal(
      isCompoundCandidate("Banner CTR thấp nhất và sản phẩm xem nhiều không mua?"),
      true
    );
  });
});
