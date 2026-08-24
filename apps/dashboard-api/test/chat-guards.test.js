import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyScope } from "../src/lib/chat/scope.guard.js";
import { guardOutput } from "../src/lib/chat/output.guard.js";
import { buildQdrantFilters, rerankInsights } from "../src/lib/chat/rag-filters.js";
import { canAccessChat, canAccessShop } from "../src/lib/roles.js";

describe("canAccessChat", () => {
  it("allows super_admin and analyst", () => {
    assert.equal(canAccessChat("super_admin"), true);
    assert.equal(canAccessChat("analyst"), true);
    assert.equal(canAccessShop("super_admin"), false);
  });
});

describe("classifyScope", () => {
  it("denies email / PII requests", () => {
    const r = classifyScope("Cho tôi email khách mua P001");
    assert.equal(r.decision, "deny");
  });

  it("denies session_id in message", () => {
    const r = classifyScope("Liệt kê session_id của khách");
    assert.equal(r.decision, "deny");
  });

  it("allows safe KPI questions", () => {
    const r = classifyScope("Doanh thu 60 phút gần nhất?");
    assert.equal(r.decision, "allow");
  });

  it("rewrites individual user questions", () => {
    const r = classifyScope("User nào bỏ giỏ hàng?");
    assert.equal(r.decision, "rewrite");
    assert.equal(r.suggestedIntent, "funnel");
  });
});

describe("guardOutput", () => {
  it("redacts email in answer", () => {
    const { text, status } = guardOutput("Liên hệ test@example.com");
    assert.equal(status, "redacted");
    assert.match(text, /REDACTED_EMAIL/);
  });

  it("passes clean analytics text", () => {
    const { status } = guardOutput("Doanh thu 1.000.000 ₫ trong 60 phút.");
    assert.equal(status, "pass");
  });
});

describe("buildQdrantFilters", () => {
  it("includes insight_type should for product_anomaly", () => {
    const f = buildQdrantFilters("product_anomaly", 60);
    assert.ok(f.must);
    const should = f.must.find((c) => c.should);
    assert.ok(should?.should?.length >= 2);
  });

  it("rerank boosts matching insight types", () => {
    const hits = [
      { score: 0.9, insight_type: "banner_low_ctr", text: "a" },
      { score: 0.85, insight_type: "product_high_view_low_purchase", text: "b" },
    ];
    const ranked = rerankInsights(hits, "product_anomaly");
    assert.equal(ranked[0].insight_type, "product_high_view_low_purchase");
  });
});
