/**
 * Rule-based action cards (Sprint 3).
 * @returns {Array<{ id, title, priority, impact, confidence, evidence, suggestion, owner_hint }>}
 */
export function buildActionCards({ intent, data, ragHits = [], minutes }) {
  const cards = [];
  const period = `${minutes} phút gần nhất`;

  for (const p of (data.anomalies || []).slice(0, 3)) {
    const sev = Number(p.severity_score) || p.views || 0;
    cards.push({
      id: `product_fix_${p.product_id}`,
      title: `Tối ưu ${p.product_name || p.product_id}`,
      priority: sev >= 15 ? "high" : "medium",
      impact: "conversion",
      confidence: sev >= 10 ? 0.8 : 0.65,
      evidence: [`${p.views} view, ${p.purchases ?? 0} mua (${period})`],
      suggestion: "Cải thiện ảnh, mô tả, giá hoặc CTA thêm giỏ hàng.",
      owner_hint: "merchandising",
    });
  }

  const worst = data.funnel?.worst_drop || data.worst_drop;
  if (worst?.label && (worst.drop_off_rate || 0) > 0.2) {
    cards.push({
      id: `funnel_${worst.step || worst.label}`,
      title: `Giảm rớt tại bước ${worst.label}`,
      priority: worst.drop_off_rate > 0.5 ? "high" : "medium",
      impact: "funnel",
      confidence: 0.75,
      evidence: [`Rớt ~${((worst.drop_off_rate || 0) * 100).toFixed(0)}% từ ${worst.from || "bước trước"}`],
      suggestion: "Rút ngắn form checkout hoặc hiển thị phí ship sớm hơn.",
      owner_hint: "product",
    });
  }

  for (const b of (data.banners || []).filter((x) => Number(x.impressions) >= 10 && Number(x.ctr) < 0.02).slice(0, 2)) {
    cards.push({
      id: `banner_${b.banner_id}`,
      title: `Đổi creative banner ${b.banner_id}`,
      priority: "medium",
      impact: "traffic",
      confidence: 0.7,
      evidence: [`CTR ${(Number(b.ctr) * 100).toFixed(2)}%, ${b.impressions} impression`],
      suggestion: "Thử ảnh/headline mới hoặc đổi vị trí hero.",
      owner_hint: "marketing",
    });
  }

  const cmp = data.comparison;
  if (cmp?.delta?.purchases_pct != null && cmp.delta.purchases_pct < -0.15) {
    cards.push({
      id: "kpi_purchases_drop",
      title: "Đơn mua giảm so với kỳ trước",
      priority: "high",
      impact: "revenue",
      confidence: 0.85,
      evidence: [`Đơn mua ${cmp.delta.purchases_pct > 0 ? "+" : ""}${(cmp.delta.purchases_pct * 100).toFixed(1)}%`],
      suggestion: "Kiểm tra promo, tồn kho và lỗi checkout.",
      owner_hint: "ops",
    });
  }

  for (const h of (ragHits || []).slice(0, 2)) {
    if (cards.length >= 5) break;
    cards.push({
      id: `insight_${h.insight_type || "rag"}`,
      title: "Theo insight pipeline",
      priority: "low",
      impact: "insight",
      confidence: 0.6,
      evidence: [h.text].filter(Boolean),
      suggestion: "Xác minh trên dashboard chi tiết.",
      owner_hint: "analyst",
    });
  }

  if (intent === "optimize" && !cards.length) {
    cards.push({
      id: "collect_more_data",
      title: "Thu thập thêm event",
      priority: "low",
      impact: "data",
      confidence: 0.5,
      evidence: [`Chưa đủ tín hiệu trong ${period}`],
      suggestion: "Chạy web-shop / bot simulator để có KPI.",
      owner_hint: "dev",
    });
  }

  const order = { high: 0, medium: 1, low: 2 };
  return cards.sort((a, b) => order[a.priority] - order[b.priority]).slice(0, 5);
}

export function formatActionsMarkdown(actions) {
  if (!actions?.length) return "";
  const lines = actions.map(
    (a, i) =>
      `${i + 1}. **[${a.priority.toUpperCase()}]** ${a.title} — ${a.suggestion}\n` +
      `   - Evidence: ${a.evidence.join("; ")}\n` +
      `   - Confidence: ${(a.confidence * 100).toFixed(0)}%`
  );
  return `\n\n**Action cards:**\n${lines.join("\n")}`;
}
