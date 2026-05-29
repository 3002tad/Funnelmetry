/** Whitelist analytics tools — no raw SQL from LLM. */
export const TOOL_REGISTRY = {
  fetchOverview: { safe: true, maxMinutes: 1440 },
  fetchTopProducts: { safe: true, maxMinutes: 1440, maxLimit: 20 },
  fetchProductAnomalies: { safe: true, maxMinutes: 1440, maxLimit: 20 },
  fetchFunnel: { safe: true, maxMinutes: 1440 },
  fetchBanners: { safe: true, maxMinutes: 1440, maxLimit: 20 },
  fetchKpiComparison: { safe: true, maxMinutes: 1440 },
  fetchRevenueTrend: { safe: true, maxMinutes: 1440 },
  fetchProductConversion: { safe: true, maxMinutes: 1440, maxLimit: 20 },
  searchInsights: { safe: true, maxMinutes: 1440, maxLimit: 20 },
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
