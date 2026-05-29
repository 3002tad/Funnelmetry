import { detectIntent, extractMinutes } from "./intent.js";
import { needsRagForIntent } from "./rag-filters.js";
import { validateToolCall } from "./tool.registry.js";

const COMPARISON_RE = /so sánh|compare|với\s+(\d+)?\s*(giờ|phút)?\s*trước|kỳ trước|hôm qua/i;
const TREND_RE = /xu hướng|trend|biến động|tăng|giảm/i;
const CONVERSION_RE = /conversion|chuyển đổi.*sản phẩm|tỷ lệ mua/i;
const ANALYZE_RE =
  /phân tích|đánh giá|nhận xét|bức tranh|vấn đề lớn|vấn đề chính|nguyên nhân|tại sao|đọc số|insight|ưu tiên/i;

export function extractEntities(message) {
  const text = message || "";
  const product = text.match(/\b(P\d{3,}|SKU[-\w]+)\b/i);
  const banner = text.match(/\b(banner[-_]?\w+|hero[-_]?\w+)\b/i);
  return {
    product_id: product?.[1]?.toUpperCase() || null,
    banner_id: banner?.[1] || null,
  };
}

/**
 * Rule-based query plan (Sprint 5 lite — no LLM planner).
 */
export function buildPlan(message, { scope, memory } = {}) {
  const minutes = extractMinutes(message, memory?.last_minutes ?? 60);
  let intent = detectIntent(message);

  if (scope?.decision === "rewrite" && scope.suggestedIntent) {
    intent = scope.suggestedIntent;
  }

  if (intent === "general" && memory?.last_intent) {
    intent = memory.last_intent;
  }

  const text = (message || "").toLowerCase();
  if (COMPARISON_RE.test(text)) intent = "comparison";
  else if (TREND_RE.test(text) && intent === "general") intent = "trend";
  else if (CONVERSION_RE.test(text) && intent === "general" && !/phễu|funnel/.test(text)) {
    intent = "product_conversion";
  }

  if (ANALYZE_RE.test(text) && ["general", "overview", "revenue", "sessions"].includes(intent)) {
    intent = "optimize";
  }

  const entities = extractEntities(message);
  const tools = toolsForIntent(intent, message);
  const needs_rag =
    needsRagForIntent(intent) || intent === "optimize" || intent === "comparison" || ANALYZE_RE.test(text);

  const validated = tools.filter((name) => {
    const v = validateToolCall(name, { minutes, limit: 20 });
    return v.ok;
  });

  return {
    intent,
    minutes,
    entities,
    tools: validated,
    needs_rag,
    from_memory: Boolean(memory?.last_intent && detectIntent(message) === "general"),
  };
}

const DEEP_ANALYSIS_TOOLS = [
  "fetchOverview",
  "fetchFunnel",
  "fetchProductAnomalies",
  "fetchBanners",
  "fetchTopProducts",
];

function toolsForIntent(intent, message = "") {
  const text = (message || "").toLowerCase();
  const wantDeep = ANALYZE_RE.test(text) || intent === "optimize";

  if (wantDeep) {
    const tools = [...DEEP_ANALYSIS_TOOLS];
    if (/so sánh|kỳ trước/.test(text)) tools.push("fetchKpiComparison");
    if (/xu hướng|trend/.test(text)) tools.push("fetchRevenueTrend");
    return [...new Set(tools)];
  }

  const map = {
    overview: ["fetchOverview", "fetchFunnel"],
    sessions: ["fetchOverview"],
    revenue: ["fetchOverview", "fetchRevenueTrend", "fetchFunnel"],
    general: ["fetchOverview", "fetchFunnel", "fetchProductAnomalies"],
    top_products: ["fetchTopProducts"],
    product_anomaly: ["fetchProductAnomalies"],
    funnel: ["fetchFunnel"],
    banner: ["fetchBanners"],
    optimize: ["fetchOverview", "fetchProductAnomalies", "fetchFunnel", "fetchBanners"],
    comparison: ["fetchKpiComparison", "fetchOverview"],
    trend: ["fetchRevenueTrend", "fetchOverview"],
    product_conversion: ["fetchProductConversion", "fetchTopProducts"],
  };
  return map[intent] || map.general;
}
