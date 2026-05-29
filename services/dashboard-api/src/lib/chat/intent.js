const RULES = [
  {
    intent: "overview",
    patterns: [
      /tóm tắt|tình hình|tổng quan|overview|hiện tại|đang như thế nào|báo cáo nhanh|website.*(thế nào|ra sao)|cửa hàng.*(thế nào|ra sao)|sức khỏe shop|shop thế nào/,
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
    intent: "optimize",
    patterns: [
      /gợi ý|tối ưu|optimize|conversion thấp|cải thiện|nên làm gì|làm sao để|tăng (doanh thu|conversion|bán)/,
    ],
  },
  {
    intent: "funnel",
    patterns: [
      /phễu|funnel|rớt|drop.?off|bước nào|checkout|thanh toán.*(rớt|bỏ)|bỏ giỏ|tỷ lệ chuyển đổi/,
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
    intent: "comparison",
    patterns: [/so sánh|kỳ trước|so với.*trước|hôm qua/i],
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
  const text = (message || "").toLowerCase();
  if (/hôm nay|today|cả ngày|24\s*h/.test(text)) return 1440;
  if (/gần đây|vừa rồi|mới đây/.test(text)) return Math.min(fallback, 120);
  const m = text.match(/(\d+)\s*(phút|minute|min)/i);
  if (m) return Math.min(parseInt(m[1], 10), 1440);
  const h = text.match(/(\d+)\s*(giờ|hour|h)\b/i);
  if (h) return Math.min(parseInt(h[1], 10) * 60, 1440);
  return fallback;
}
