/** Map chat intent → Qdrant insight_type values from streaming-processor. */
const INSIGHT_TYPES_BY_INTENT = {
  product_anomaly: [
    "product_high_view_low_purchase",
    "product_high_click_low_purchase",
  ],
  product_detail: [
    "product_high_view_low_purchase",
    "product_high_click_low_purchase",
  ],
  insights: [
    "product_high_view_low_purchase",
    "product_high_click_low_purchase",
    "cart_no_purchase",
    "sessions_no_cart",
    "banner_low_ctr",
    "banner_strong_ctr",
  ],
  cart_abandon: ["cart_no_purchase", "sessions_no_cart"],
  conversion: ["cart_no_purchase", "sessions_no_cart"],
  banner: ["banner_low_ctr", "banner_strong_ctr"],
  funnel: ["cart_no_purchase", "sessions_no_cart"],
  optimize: [
    "product_high_view_low_purchase",
    "product_high_click_low_purchase",
    "cart_no_purchase",
    "sessions_no_cart",
    "banner_low_ctr",
  ],
};

export function windowStartIso(minutes) {
  const ms = Math.min(Math.max(Number(minutes) || 60, 1), 10080) * 60 * 1000;
  return new Date(Date.now() - ms).toISOString();
}

/**
 * Build Qdrant filter: time window + optional insight_type (should match any).
 * @returns {object|null}
 */
export function buildQdrantFilters(intent, minutes) {
  const types = INSIGHT_TYPES_BY_INTENT[intent];
  const gte = windowStartIso(minutes);
  const timeClause = { key: "created_at", range: { gte } };

  if (!types?.length) {
    return { must: [timeClause] };
  }

  return {
    must: [
      timeClause,
      {
        should: types.map((value) => ({
          key: "insight_type",
          match: { value },
        })),
      },
    ],
  };
}

const RAG_INTENTS = new Set([
  "product_anomaly",
  "optimize",
  "general",
  "banner",
  "overview",
  "funnel",
  "comparison",
  "trend",
  "product_conversion",
  "product_detail",
  "insights",
  "cart_abandon",
  "conversion",
]);

export function needsRagForIntent(intent) {
  return RAG_INTENTS.has(intent);
}

/**
 * Re-rank: boost insight types aligned with intent; keep vector score.
 */
export function rerankInsights(hits, intent) {
  const matchTypes = new Set(INSIGHT_TYPES_BY_INTENT[intent] || []);
  const ranked = [...(hits || [])].map((h) => {
    let score = Number(h.score) || 0;
    if (matchTypes.has(h.insight_type)) score += 0.15;
    return { ...h, rerank_score: score };
  });
  ranked.sort((a, b) => b.rerank_score - a.rerank_score);
  return ranked;
}
