/** Whitelist analytics tools — no raw SQL from LLM. */
const MAX_QUERY_MINUTES = 10080; // 7 days

export const TOOL_REGISTRY = {
  fetchOverview: { safe: true, maxMinutes: MAX_QUERY_MINUTES },
  fetchTopProducts: { safe: true, maxMinutes: MAX_QUERY_MINUTES, maxLimit: 20 },
  fetchProductAnomalies: { safe: true, maxMinutes: MAX_QUERY_MINUTES, maxLimit: 20 },
  fetchFunnel: { safe: true, maxMinutes: MAX_QUERY_MINUTES },
  fetchBanners: { safe: true, maxMinutes: MAX_QUERY_MINUTES, maxLimit: 20 },
  fetchKpiComparison: { safe: true, maxMinutes: MAX_QUERY_MINUTES },
  fetchRevenueTrend: { safe: true, maxMinutes: MAX_QUERY_MINUTES },
  fetchProductConversion: { safe: true, maxMinutes: MAX_QUERY_MINUTES, maxLimit: 20 },
  fetchProductDetail: { safe: true, maxMinutes: MAX_QUERY_MINUTES },
  fetchTopSearches: { safe: true, maxMinutes: MAX_QUERY_MINUTES, maxLimit: 20 },
  fetchSearchFilters: { safe: true, maxMinutes: MAX_QUERY_MINUTES, maxLimit: 30 },
  fetchCategoryPerformance: { safe: true, maxMinutes: MAX_QUERY_MINUTES, maxLimit: 20 },
  fetchCatalogStats: { safe: true, maxMinutes: MAX_QUERY_MINUTES },
  fetchBannerDetail: { safe: true, maxMinutes: MAX_QUERY_MINUTES },
  searchInsights: { safe: true, maxMinutes: MAX_QUERY_MINUTES, maxLimit: 20 },
};

export function validateToolCall(name, params = {}) {
  const spec = TOOL_REGISTRY[name];
  if (!spec?.safe) return { ok: false, reason: "tool_not_allowed" };
  if (params.minutes != null && params.minutes > spec.maxMinutes) {
    return { ok: false, reason: "time_window_too_large" };
  }
  if (params.limit != null && spec.maxLimit != null && params.limit > spec.maxLimit) {
    return { ok: false, reason: "limit_too_large" };
  }
  return { ok: true };
}
