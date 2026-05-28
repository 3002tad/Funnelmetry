const RULES = [
  {
    intent: "overview",
    patterns: [
      /tóm tắt|tình hình|tổng quan|overview|hiện tại|đang như thế nào|báo cáo nhanh|website.*(thế nào|ra sao)|cửa hàng.*(thế nào|ra sao)/,
    ],
  },
  {
    intent: "top_products",
    patterns: [
      /top\s*sản phẩm|sản phẩm.*(xem|view).*(nhiều|nhất)|xem nhiều nhất|bán chạy|hot nhất|được quan tâm/,
    ],
  },
  {
    intent: "product_anomaly",
    patterns: [
      /nhiều view.*(ít|thấp|không).*mua|view.*(mà|nhưng).*(không|chẳng|ít).*mua|xem nhiều.*(không|ít).*mua|high.view|ít mua|không mua|bị bỏ rơi/,
    ],
  },
  {
    intent: "funnel",
    patterns: [
      /phễu|funnel|rớt|drop.?off|bước nào|checkout|thanh toán.*(rớt|bỏ)|bỏ giỏ|tỷ lệ chuyển đổi|conversion/,
    ],
  },
  {
    intent: "sessions",
    patterns: [/session|phiên|khách.*(đang|hoạt động|truy cập)|bao nhiêu.*(người|khách|session)|traffic|lượt truy cập/],
  },
  {
    intent: "revenue",
    patterns: [/doanh thu|revenue|bán được bao nhiêu|kiếm được|tiền|đơn hàng/],
  },
  {
    intent: "banner",
    patterns: [/banner|quảng cáo|ctr|impression|slide|hero/],
  },
  {
    intent: "optimize",
    patterns: [
      /gợi ý|tối ưu|optimize|conversion thấp|cải thiện|nên làm gì|làm sao để|tăng (doanh thu|conversion|bán)/,
    ],
  },
];

export function detectIntent(message) {
  const text = (message || "").toLowerCase().trim();
  if (!text) return "unknown";

  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(text))) {
      return rule.intent;
    }
  }
  return "general";
}

export function extractMinutes(message, fallback = 60) {
  const text = message || "";
  const m = text.match(/(\d+)\s*(phút|minute|min)/i);
  if (m) return Math.min(parseInt(m[1], 10), 1440);
  const h = text.match(/(\d+)\s*(giờ|hour|h)\b/i);
  if (h) return Math.min(parseInt(h[1], 10) * 60, 1440);
  return fallback;
}
