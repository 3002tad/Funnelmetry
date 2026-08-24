import { detectStaticIntent } from "./static-intents.js";
import {
  detectIntent,
  extractBannerNameQuery,
  extractMinutes,
  extractProductSort,
  extractProductNameQuery,
  hasExplicitTime,
  isConcreteProductName,
  isLikelyFollowUp,
} from "./intent.js";
import { needsRagForIntent } from "./rag-filters.js";
import { validateToolCall } from "./tool.registry.js";
import { tryLlmPlanSlots } from "./llm-planner.js";
import { isCompoundCandidate, splitCompoundClauses } from "./compound.js";
import { extractCalendarDate } from "./calendar-extract.js";
import { isHighestOrderQuery, isOrderContextQuery, isViewPurchaseGapQuery } from "./intent.js";

const COMPARISON_RE = /so sánh|compare|với\s+(\d+)?\s*(giờ|phút)?\s*trước|kỳ trước|hôm qua/i;
const TREND_RE = /xu hướng|trend|biến động|tăng|giảm/i;
const CONVERSION_RE = /conversion|chuyển đổi.*sản phẩm|tỷ lệ mua/i;
const ANALYZE_RE =
  /phân tích|đánh giá|nhận xét|bức tranh|vấn đề lớn|vấn đề chính|nguyên nhân|tại sao|đọc số|insight|ưu tiên/i;

export function extractEntities(message, memory) {
  const text = message || "";
  const product = text.match(/\b(P\d{3,}|SKU[-\w]+)\b/i);
  const banner = text.match(/\b(banner[-_]?\w+|hero[-_]?\w+)\b/i);
  let product_name = extractProductNameQuery(text);
  let product_id = product?.[1]?.toUpperCase() || null;
  let banner_id = banner?.[1] || null;
  let banner_name = extractBannerNameQuery(text);

  if (!product_name && !product_id && memory && isLikelyFollowUp(text) && !isOrderContextQuery(text)) {
    product_name = memory.last_product_name || null;
    product_id = memory.last_product_id || product_id;
  }
  if (!banner_id && !banner_name && memory && isLikelyFollowUp(text)) {
    banner_name = memory.last_banner_name || null;
    banner_id = memory.last_banner_id || banner_id;
  }

  return {
    product_id,
    product_name,
    banner_id,
    banner_name,
  };
}

/**
 * Rule-based query plan (fast path). LLM enrichment via buildPlanAsync when enabled.
 */
export function buildPlan(message, { scope, memory } = {}) {
  const compound = buildCompoundPlan(message, { scope, memory });
  if (compound) return compound;
  return finalizePlan(message, resolveCorePlan(message, { scope, memory }));
}

function buildCompoundPlan(message, { scope, memory } = {}) {
  if (scope?.decision === "deny" || !isCompoundCandidate(message)) return null;

  const clauses = splitCompoundClauses(message);
  if (!clauses) return null;

  const subCores = clauses.map((clause) => ({
    clause,
    ...resolveCorePlan(clause, { scope, memory }),
  }));

  const analytics = subCores.filter((s) => !NON_COMPOUND_INTENTS.has(s.intent));
  const uniqueIntents = [...new Set(analytics.map((s) => s.intent))];
  if (uniqueIntents.length < 2) return null;

  const minutes = extractMinutes(message, memory?.last_minutes ?? 60);
  const entities = extractEntities(message, memory);
  const product_sort =
    analytics.find((s) => s.intent === "top_products")?.product_sort ||
    extractProductSort(message) ||
    memory?.last_product_sort ||
    "views";

  const toolSet = new Set();
  for (const sub of analytics) {
    for (const t of toolsForIntent(sub.intent, sub.clause)) {
      toolSet.add(t);
    }
  }

  const validated = [...toolSet].filter((name) => {
    const v = validateToolCall(name, { minutes, limit: 20 });
    return v.ok;
  });

  const needs_rag = analytics.some(
    (s) => s.intent === "insights" || needsRagForIntent(s.intent) || s.intent === "comparison"
  );

  return {
    intent: "compound",
    compound: true,
    sub_intents: analytics.map(({ clause, intent, product_sort: ps }) => ({
      clause,
      intent,
      product_sort: ps,
    })),
    minutes,
    product_sort,
    entities,
    tools: validated,
    needs_rag,
    from_memory: false,
    planner_source: "compound",
  };
}

const NON_COMPOUND_INTENTS = new Set([
  "greeting",
  "help",
  "thanks",
  "goodbye",
  "ack",
  "off_topic",
  "general",
  "optimize",
]);

function resolveCorePlan(message, { scope, memory } = {}) {
  const calendar_date = extractCalendarDate(message);
  let minutes = calendar_date ? 1440 : extractMinutes(message, 60);
  const product_sort = extractProductSort(message) || memory?.last_product_sort || "views";
  let intent = detectIntent(message);

  if (scope?.decision === "rewrite" && scope.suggestedIntent) {
    intent = scope.suggestedIntent;
  }

  const rawIntent = detectIntent(message);
  if (intent === "general" && memory?.last_intent) {
    intent = memory.last_intent;
  }

  const text = (message || "").toLowerCase();
  if (
    isViewPurchaseGapQuery(message) ||
    (/tại sao|giải thích|nguyên nhân|vì sao/.test(text) &&
      ["top_products", "product_anomaly"].includes(memory?.last_intent) &&
      (/(xem|view|lượt xem|mua)/.test(text) || isLikelyFollowUp(message)))
  ) {
    intent = "product_anomaly";
  }
  if (COMPARISON_RE.test(text)) intent = "comparison";
  else if (TREND_RE.test(text) && (intent === "general" || rawIntent === "trend")) intent = "trend";
  else if (CONVERSION_RE.test(text) && intent === "general" && !/phễu|funnel/.test(text)) {
    intent = "product_conversion";
  }

  // "phân tích doanh thu …" → keep revenue (grounded KPI), not optimize + action cards.
  if (ANALYZE_RE.test(text) && ["general", "overview", "sessions"].includes(intent)) {
    intent = "optimize";
  }

  const entities = extractEntities(message, memory);
  const lastMsg = (memory?.last_message || "").toLowerCase();
  const priorOrderThread =
    memory?.last_intent === "recent_purchases" ||
    /đơn đó|trong đơn|sản phẩm trong đơn|đơn này|đơn hàng đó/.test(lastMsg);
  const orderShowMore =
    priorOrderThread && /cho mình xem|xem thông tin|thông tin đi|đâu bạn/.test(text);
  const orderFollowUp =
    orderShowMore ||
    (isLikelyFollowUp(message) &&
      (priorOrderThread ||
        (["revenue", "orders", "overview", "conversion"].includes(memory?.last_intent) &&
          /đơn|trong đơn|sản phẩm trong/.test(text))));
  if (isOrderContextQuery(text) || orderFollowUp) {
    intent = "recent_purchases";
    entities.product_name = null;
    entities.product_id = null;
    if (isHighestOrderQuery(message)) {
      entities.order_sort = "amount_desc";
    }
    if (memory?.last_order_id && (isOrderContextQuery(text) || orderShowMore || priorOrderThread)) {
      entities.focus_order_id = memory.last_order_id;
    }
    if (memory?.last_minutes && !hasExplicitTime(message) && !calendar_date) {
      minutes = memory.last_minutes;
    }
  }

  const hasConcreteProduct =
    (entities.product_name && isConcreteProductName(entities.product_name)) || Boolean(entities.product_id);
  if (
    intent !== "recent_purchases" &&
    (rawIntent === "product_detail" ||
      (hasConcreteProduct && /sản phẩm|sp\b|chi tiết/i.test(text) && !/\bđơn\b/.test(text)) ||
      (entities.product_id && /chi tiết|thông tin|sản phẩm|sp\b/i.test(text)))
  ) {
    intent = "product_detail";
  } else if (
    intent !== "recent_purchases" &&
    isLikelyFollowUp(message) &&
    memory?.last_intent === "product_detail"
  ) {
    intent = "product_detail";
  }

  if (
    rawIntent === "banner_detail" ||
    (entities.banner_name && /banner|hero|slide/i.test(text)) ||
    (entities.banner_id && /chi tiết|thông tin|banner/i.test(text))
  ) {
    intent = "banner_detail";
  } else if (isLikelyFollowUp(message) && memory?.last_intent === "banner_detail") {
    intent = "banner_detail";
  }

  if (
    !calendar_date &&
    !hasExplicitTime(message) &&
    ["top_products", "product_anomaly", "orders", "revenue"].includes(intent) &&
    minutes <= 60
  ) {
    minutes = 10080;
  }

  if (
    !calendar_date &&
    !hasExplicitTime(message) &&
    memory?.last_minutes != null &&
    (rawIntent === "general" ||
      isLikelyFollowUp(message) ||
      (intent === "product_anomaly" && ["top_products", "product_anomaly"].includes(memory?.last_intent)))
  ) {
    minutes = memory.last_minutes;
  }

  return {
    intent,
    minutes,
    calendar_date: calendar_date || null,
    product_sort,
    entities,
    from_memory: Boolean(memory?.last_intent && rawIntent === "general"),
    planner_source: "rules",
  };
}

function finalizePlan(message, core) {
  const { intent, minutes, calendar_date, product_sort, entities, from_memory, planner_source } = core;
  const text = (message || "").toLowerCase();
  const tools = toolsForIntent(intent, message);
  const needs_rag =
    intent === "insights" ||
    needsRagForIntent(intent) ||
    intent === "optimize" ||
    intent === "comparison" ||
    ANALYZE_RE.test(text);

  const validated = tools.filter((name) => {
    const v = validateToolCall(name, { minutes, limit: 20 });
    return v.ok;
  });

  return {
    intent,
    minutes,
    calendar_date: calendar_date || null,
    product_sort,
    entities,
    tools: validated,
    needs_rag,
    from_memory,
    planner_source,
  };
}

/**
 * Merge LLM slots into rule plan — rules win on explicit time; LLM helps vague/follow-up queries.
 */
export function applyLlmSlots(rulePlan, llmSlots, message, memory) {
  if (!llmSlots) return rulePlan;

  const rawIntent = detectIntent(message);
  const ruleIntentSpecific = rawIntent !== "general";
  const explicitTime = hasExplicitTime(message);
  const explicitSort = /doanh thu|revenue|mua.*(nhiều|nhất)|bán.*(nhiều|nhất)|xem nhiều|view nhiều|purchase|best seller/i.test(
    message || ""
  );

  let intent = rulePlan.intent;
  if (intent === "recent_purchases" || isOrderContextQuery(message)) {
    intent = "recent_purchases";
  } else if (!ruleIntentSpecific && llmSlots.intent !== "general") {
    intent = llmSlots.intent;
  } else if (llmSlots.is_followup && memory?.last_intent && rawIntent === "general") {
    intent = memory.last_intent;
  }

  let minutes = rulePlan.minutes;
  let calendar_date = rulePlan.calendar_date;
  if (!explicitTime && llmSlots.minutes != null) {
    minutes = llmSlots.minutes;
  }
  if (!calendar_date && llmSlots.calendar_date) {
    calendar_date = llmSlots.calendar_date;
  }

  let product_sort = rulePlan.product_sort;
  if (!explicitSort && llmSlots.product_sort) {
    product_sort = llmSlots.product_sort;
  } else if (!explicitSort && llmSlots.is_followup && memory?.last_product_sort) {
    product_sort = memory.last_product_sort;
  }

  const from_memory = rulePlan.from_memory || llmSlots.is_followup;

  return finalizePlan(message, {
    intent,
    minutes,
    calendar_date,
    product_sort,
    entities: rulePlan.entities,
    from_memory,
    planner_source: "llm+rules",
  });
}

function shouldUseLlmPlanner(message, rulePlan) {
  if (rulePlan.intent === "compound" || rulePlan.compound) return false;
  if (rulePlan.intent === "recent_purchases" || isOrderContextQuery(message)) return false;
  if (detectStaticIntent(message, null, detectIntent(message) === "general")) return false;
  const rawIntent = detectIntent(message);
  if (STATIC_ANALYTICS_INTENTS.has(rawIntent) && rawIntent !== "general") return false;
  if (rawIntent === "general") return true;
  if (isLikelyFollowUp(message)) return true;
  if (!hasExplicitTime(message) && rulePlan.minutes <= 120) return true;
  return false;
}

const STATIC_ANALYTICS_INTENTS = new Set([
  "overview",
  "top_products",
  "product_anomaly",
  "product_detail",
  "banner_detail",
  "optimize",
  "funnel",
  "cart_abandon",
  "checkout",
  "sessions",
  "pageviews",
  "events",
  "revenue",
  "orders",
  "recent_purchases",
  "aov",
  "banner",
  "comparison",
  "trend",
  "product_conversion",
  "conversion",
  "insights",
  "search",
  "filters",
  "category",
  "catalog",
]);

/**
 * Hybrid planner: rules first, optional Ollama slot fill for ambiguous/follow-up questions.
 */
function applyRequestPeriod(plan, { calendarDate, minutes, message } = {}) {
  if (calendarDate) {
    return { ...plan, calendar_date: calendarDate };
  }
  // Explicit time in the question beats dashboard period filter from the client.
  if (minutes != null && !(message && hasExplicitTime(message))) {
    return { ...plan, minutes };
  }
  return plan;
}

export async function buildPlanAsync(
  message,
  { scope, memory, ollamaOpts, enableLlmPlanner = true, calendarDate, minutes } = {}
) {
  const rulePlan = buildPlan(message, { scope, memory });
  let plan = rulePlan;
  if (enableLlmPlanner && ollamaOpts?.baseUrl && shouldUseLlmPlanner(message, rulePlan)) {
    try {
      const slots = await tryLlmPlanSlots(message, { memory, ollamaOpts });
      if (slots) plan = applyLlmSlots(rulePlan, slots, message, memory);
    } catch (err) {
      console.warn("chat: LLM planner failed, using rules:", err.message);
    }
  }
  return applyRequestPeriod(plan, { calendarDate, minutes, message });
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
  const wantDeep =
    (ANALYZE_RE.test(text) || intent === "optimize") &&
    ![
      "revenue",
      "orders",
      "aov",
      "comparison",
      "trend",
      "top_products",
      "product_anomaly",
      "recent_purchases",
      "funnel",
      "cart_abandon",
      "conversion",
    ].includes(intent);

  if (wantDeep) {
    const tools = [...DEEP_ANALYSIS_TOOLS];
    if (/so sánh|kỳ trước/.test(text)) tools.push("fetchKpiComparison");
    if (/xu hướng|trend/.test(text)) tools.push("fetchRevenueTrend");
    return [...new Set(tools)];
  }

  const map = {
    ack: [],
    greeting: [],
    help: [],
    thanks: [],
    goodbye: [],
    off_topic: [],
    compound: [],
    overview: ["fetchOverview", "fetchFunnel"],
    sessions: ["fetchOverview"],
    revenue: ["fetchOverview", "fetchRevenueTrend", "fetchFunnel"],
    general: ["fetchOverview"],
    top_products: ["fetchTopProducts"],
    product_anomaly: ["fetchProductAnomalies", "fetchTopProducts"],
    funnel: ["fetchFunnel"],
    cart_abandon: ["fetchFunnel", "fetchOverview"],
    conversion: ["fetchOverview", "fetchFunnel"],
    banner: ["fetchBanners"],
    optimize: ["fetchOverview", "fetchProductAnomalies", "fetchFunnel", "fetchBanners"],
    comparison: ["fetchKpiComparison", "fetchOverview"],
    trend: ["fetchRevenueTrend", "fetchOverview"],
    product_conversion: ["fetchProductConversion", "fetchTopProducts"],
    product_detail: ["fetchProductDetail"],
    banner_detail: ["fetchBannerDetail"],
    search: ["fetchTopSearches"],
    filters: ["fetchSearchFilters"],
    category: ["fetchCategoryPerformance"],
    catalog: ["fetchCatalogStats"],
    orders: ["fetchOverview"],
    recent_purchases: ["fetchRecentPurchases", "fetchOverview"],
    aov: ["fetchOverview"],
    pageviews: ["fetchOverview"],
    events: ["fetchOverview"],
    checkout: ["fetchFunnel", "fetchOverview"],
    insights: ["fetchOverview"],
  };
  return map[intent] || map.general;
}
