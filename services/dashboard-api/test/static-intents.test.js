import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPlan } from "../src/lib/chat/planner.js";
import { detectStaticIntent, isHelpMessage, isThanksMessage } from "../src/lib/chat/static-intents.js";
import { detectIntent } from "../src/lib/chat/intent.js";

describe("static intents", () => {
  it("detects help", () => {
    assert.equal(isHelpMessage("bạn làm được gì"), true);
    const hit = detectStaticIntent("help", null, false);
    assert.equal(hit.intent, "help");
  });

  it("detects thanks", () => {
    assert.equal(isThanksMessage("cảm ơn"), true);
    const hit = detectStaticIntent("cảm ơn bạn", null, false);
    assert.equal(hit.intent, "thanks");
  });

  it("routes gibberish general to off_topic", () => {
    const hit = detectStaticIntent("abc xyz random", null, true);
    assert.equal(hit.intent, "off_topic");
  });

  it("detects ack", () => {
    const hit = detectStaticIntent("ok", null, false);
    assert.equal(hit.intent, "ack");
  });

  it("allows follow-up with memory", () => {
    const hit = detectStaticIntent("còn hôm qua", { last_intent: "revenue" }, true);
    assert.equal(hit, null);
  });
});

describe("analytics intents", () => {
  it("plans insights with RAG", () => {
    const plan = buildPlan("insight pipeline gần đây", { scope: { decision: "allow" } });
    assert.equal(plan.intent, "insights");
    assert.equal(plan.needs_rag, true);
  });

  it("plans cart_abandon", () => {
    const plan = buildPlan("khách bỏ giỏ nhiều không", { scope: { decision: "allow" } });
    assert.equal(plan.intent, "cart_abandon");
    assert.ok(plan.tools.includes("fetchFunnel"));
  });

  it("plans search queries", () => {
    const plan = buildPlan("top tìm kiếm tuần qua", { scope: { decision: "allow" } });
    assert.equal(plan.intent, "search");
    assert.ok(plan.tools.includes("fetchTopSearches"));
  });

  it("plans aov", () => {
    const plan = buildPlan("AOV hôm nay", { scope: { decision: "allow" } });
    assert.equal(plan.intent, "aov");
  });

  it("plans category performance", () => {
    const plan = buildPlan("doanh thu theo danh mục", { scope: { decision: "allow" } });
    assert.equal(plan.intent, "category");
  });
});
