const TYPE_LABELS = {
  page_view: "Xem trang",
  product_view: "Xem SP",
  search: "Tìm kiếm",
  filter_apply: "Áp dụng lọc",
  add_to_cart: "Thêm giỏ",
  remove_from_cart: "Bỏ khỏi giỏ",
  checkout_start: "Checkout",
  purchase: "Mua hàng",
  banner_impression: "Banner imp.",
  banner_click: "Banner click",
  click: "Click",
};

export function eventTypeLabel(type) {
  return TYPE_LABELS[type] || type;
}

export function buildEventTypeRows(events) {
  const counts = {};
  for (const e of events || []) {
    const t = e.event_type || "unknown";
    counts[t] = (counts[t] || 0) + 1;
  }
  const total = Object.values(counts).reduce((s, n) => s + n, 0);
  return Object.entries(counts)
    .map(([type, count]) => ({
      type,
      label: eventTypeLabel(type),
      count,
      sharePct: total > 0 ? (count / total) * 100 : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

export function buildEventSummary(events, typeRows) {
  const commerce = (events || []).filter((e) => e.event_category === "commerce").length;
  const behavior = (events || []).filter((e) => e.event_category === "behavior").length;
  const total = events?.length || 0;
  const topType = typeRows[0];

  const sessions = new Set((events || []).map((e) => e.session_id).filter(Boolean));

  return {
    total,
    commerce,
    behavior,
    uniqueSessions: sessions.size,
    topType,
    typeCount: typeRows.length,
  };
}

export function buildEventActionItems(summary) {
  if (!summary || summary.total === 0) {
    return [{
      key: "empty",
      level: "medium",
      title: "Chưa có event",
      value: "0",
      hint: "Thao tác trên web demo để sinh luồng tracking.",
    }];
  }

  const commercePct = summary.total > 0 ? (summary.commerce / summary.total) * 100 : 0;

  return [
    {
      key: "top-type",
      level: "good",
      title: "Event phổ biến",
      value: summary.topType?.label || "—",
      hint: summary.topType
        ? `${summary.topType.count.toLocaleString("vi-VN")} lần (${summary.topType.sharePct.toFixed(0)}%).`
        : "—",
    },
    {
      key: "commerce-mix",
      level: commercePct < 10 && commercePct > 0 ? "medium" : "good",
      title: "Tỷ lệ commerce",
      value: `${commercePct.toFixed(0)}%`,
      hint: commercePct < 10
        ? "Ít event commerce — kiểm tra luồng RabbitMQ / checkout."
        : `${summary.commerce.toLocaleString("vi-VN")} event commerce trong buffer.`,
    },
    {
      key: "sessions",
      level: "good",
      title: "Phiên (ước lượng)",
      value: String(summary.uniqueSessions),
      hint: `Ước tính từ ${summary.total} event trong luồng hiện tại.`,
    },
  ];
}
