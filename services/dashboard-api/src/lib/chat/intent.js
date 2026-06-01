import { isGreetingMessage, isHelpMessage } from "./static-intents.js";

export function isOrderContextQuery(message) {
  const text = (message || "").toLowerCase();
  return (
    /đơn đó|đơn này|đơn hàng đó|order đó|trong đơn đó|trong \d+\s*đơn/.test(text) ||
    /sản phẩm trong đơn|mặt hàng trong đơn|đơn đó có (những )?sản phẩm|có những sản phẩm nào/.test(text) ||
    /xem (thông tin )?đơn|chi tiết đơn|thông tin đơn hàng/.test(text) ||
    isHighestOrderQuery(message)
  );
}

export function isHighestOrderQuery(message) {
  const text = (message || "").toLowerCase();
  return (
    /đơn nào.*(cao nhất|lớn nhất|max|nhiều tiền nhất)/.test(text) ||
    /(cao nhất|lớn nhất|giá trị cao nhất).*(đơn|order)/.test(text) ||
    /đơn.*(cao nhất|lớn nhất|giá trị cao nhất)/.test(text)
  );
}

const RULES = [
  {
    intent: "recent_purchases",
    patterns: [
      /đơn đó|đơn này|đơn hàng đó/,
      /trong đơn|sản phẩm trong đơn|mặt hàng trong đơn/,
      /đơn (vừa|mới) (mua|đặt)|xem đơn|chi tiết đơn/,
      /trong \d+\s*đơn/,
      /đơn nào.*(cao nhất|lớn nhất)/,
      /giá trị cao nhất/,
    ],
  },
  {
    intent: "category",
    patterns: [
      /danh mục|category|theo ngành|ngành hàng|electronics|fashion|doanh thu.*danh mục|category performance/i,
    ],
  },
  {
    intent: "revenue",
    patterns: [
      /doanh thu|revenue|bán được bao nhiêu|kiếm được|tiền|gmv|sales|thu nhập|tổng tiền/,
    ],
  },
  {
    intent: "overview",
    patterns: [
      /tóm tắt|tình hình|tổng quan|overview|báo cáo nhanh|website.*(thế nào|ra sao)|cửa hàng.*(thế nào|ra sao)|sức khỏe shop|shop thế nào/,
      /tình trạng|snapshot|health check|bức tranh tổng|metrics chính|chỉ số chính/,
      /đang như thế nào|shop.*hiện tại|website.*hiện tại|cửa hàng.*hiện tại/,
    ],
  },
  {
    intent: "top_products",
    patterns: [
      /top\s*sản phẩm|sản phẩm.*(xem|view).*(nhiều|nhất)|xem nhiều nhất|bán chạy|hot nhất|được quan tâm/,
      /sản phẩm.*(mua|bán).*(nhiều|nhất)|mua nhiều nhất|bán nhiều nhất|được mua nhiều|đc mua|được mua|purchase.*most/i,
      /(sp|sản phẩm) nào.*(mua|bán).*(nhiều|nhất)/i,
      /best\s*seller|hàng bán|sp nào hot|sản phẩm nổi|ranking|xếp hạng|đứng đầu|lead|cái nào.*(bán|mua|hot)/i,
      /nhiều (view|lượt xem|đơn|mua) nhất|top \d+|sản phẩm nào (hot|đỉnh)/,
    ],
  },
  {
    intent: "product_anomaly",
    patterns: [
      /nhiều view.*(ít|thấp|không).*mua|view.*(mà|nhưng).*(không|chẳng|ít).*mua|xem nhiều.*(không|ít).*mua|high.view|ít mua|không mua|bị bỏ rơi/,
      /xem nhiều.*mua ít|view nhiều.*mua ít|mua ít.*(dù|mặc dù|nhưng).*xem nhiều/,
      /lắm view|view cao.*(conversion|mua).*(thấp|kém)|quan tâm mà không mua|xem nhiều mà không|traffic cao.*ít đơn/,
    ],
  },
  {
    intent: "product_detail",
    patterns: [
      /chi tiết\s+(sản phẩm|sp)\b|thông tin\s+(sản phẩm|sp)\b/i,
      /(sản phẩm|sp)\s+.+\s+(thế nào|ra sao|performance|conversion|doanh thu|view|mua|bán)/i,
      /(phân tích|đánh giá|xem)\s+(sản phẩm|sp)\s+/i,
      /\b(P\d{3,})\b.*(chi tiết|thông tin|thế nào|ra sao)/i,
    ],
  },
  {
    intent: "search",
    patterns: [
      /từ khóa tìm|top tìm kiếm|search query|tìm kiếm nhiều|keyword search|người dùng tìm gì|search term/i,
      /tìm kiếm.*(nhiều|phổ biến|hot)|query.*(search|tìm)/i,
    ],
  },
  {
    intent: "filters",
    patterns: [/bộ lọc|filter apply|lọc sản phẩm|sort mode|sắp xếp.*filter|category filter/i],
  },
  {
    intent: "orders",
    patterns: [
      /số đơn|bao nhiêu đơn|mấy đơn|đơn mua|purchase count|\borders\b|có bao nhiêu đơn/i,
    ],
  },
  {
    intent: "aov",
    patterns: [/aov|aoq|giá trị đơn trung bình|đơn trung bình|trung bình.*(đơn|order)|average order/i],
  },
  {
    intent: "pageviews",
    patterns: [/page view|pageview|\bpv\b|lượt xem trang|xem trang|product view|lượt xem sản phẩm/i],
  },
  {
    intent: "events",
    patterns: [/tổng event|total event|event count|bao nhiêu event|volume event|sự kiện tracking/i],
  },
  {
    intent: "catalog",
    patterns: [/catalog|danh sách sản phẩm|bao nhiêu sản phẩm|có mấy sp|products_catalog/i],
  },
  {
    intent: "checkout",
    patterns: [/checkout|thanh toán|bước thanh toán|payment step|pay now/i],
  },
  {
    intent: "banner_detail",
    patterns: [
      /chi tiết\s+banner|thông tin\s+banner|banner\s+.+\s+(thế nào|ra sao|ctr)/i,
      /\b(banner[-_]?\w+|hero[-_]?\w+)\b.*(chi tiết|ctr|impression)/i,
    ],
  },
  {
    intent: "insights",
    patterns: [
      /insight|qdrant|pipeline.*(phát hiện|cảnh báo)|cảnh báo gần|điểm bất thường|sự kiện bất thường/i,
      /streaming.*(phát hiện|insight)|bất thường.*(pipeline|hệ thống)|insight gần đây/i,
    ],
  },
  {
    intent: "cart_abandon",
    patterns: [
      /bỏ giỏ|cart abandon|giỏ hàng.*(bỏ|rời|không mua)|abandonment|thêm giỏ.*(không|chưa).*(mua|checkout)/i,
      /add.?to.?cart.*(không|chưa).*(mua|checkout)|rớt.*(giỏ|cart)/i,
    ],
  },
  {
    intent: "conversion",
    patterns: [
      /tỷ lệ chuyển đổi(?!.*sản phẩm)|conversion rate|\bcr\b.*shop|chuyển đổi (chung|tổng|shop|website)/i,
      /conversion(?!.*sản phẩm).*shop|mua\/session|session.*conversion/i,
    ],
  },
  {
    intent: "optimize",
    patterns: [
      /gợi ý|tối ưu|optimize|conversion thấp|cải thiện|nên làm gì|làm sao để|tăng (doanh thu|conversion|bán)/,
      /khuyên|đề xuất|hành động|action item|vấn đề (gì|lớn|chính)|cần sửa|ưu tiên|recommend/,
    ],
  },
  {
    intent: "funnel",
    patterns: [
      /phễu|funnel|rớt|drop.?off|bước nào|checkout|thanh toán.*(rớt|bỏ)|bỏ giỏ|tỷ lệ chuyển đổi/,
      /thoát|abandon|rời (trang|site)|giỏ hàng|cart|không mua|chưa mua|add.?to.?cart|đặt hàng.*(rớt|bỏ)/i,
    ],
  },
  {
    intent: "sessions",
    patterns: [
      /session|phiên|khách.*(đang|hoạt động|truy cập)|bao nhiêu.*(người|khách|session)|traffic|lượt truy cập/,
      /visitor|người vào|khách vào|active user|uv\b/,
    ],
  },
  {
    intent: "banner",
    patterns: [/banner|quảng cáo|ctr|impression|slide|hero|promo|slider|creative/],
  },
  {
    intent: "comparison",
    patterns: [/so sánh|kỳ trước|so với.*trước|tăng hay giảm|so với hôm qua|period over period/i],
  },
  {
    intent: "trend",
    patterns: [/xu hướng|trend|biến động|đồ thị|chart|theo thời gian|dạng sóng/],
  },
  {
    intent: "product_conversion",
    patterns: [
      /conversion.*sản phẩm|tỷ lệ mua.*sản phẩm|cr sản phẩm|sản phẩm.*conversion|view.*mua.*tỷ lệ/,
      /sản phẩm nào.*(conversion|chuyển đổi)/,
    ],
  },
];

/** Why high views but few purchases — analytics, not chit-chat. */
export function isViewPurchaseGapQuery(message) {
  const text = (message || "").toLowerCase();
  if (
    /nhiều view.*(ít|thấp|không).*mua|xem nhiều.*mua ít|view nhiều.*mua ít|ít mua.*xem nhiều|không mua.*xem nhiều/i.test(
      text
    )
  ) {
    return true;
  }
  return (
    /tại sao|vì sao|nguyên nhân|giải thích|lý do/.test(text) &&
    /(xem|view|lượt xem)/.test(text) &&
    /(mua|purchase|đơn)/.test(text) &&
    /(ít|thấp|kém|không|chẳng|0)/.test(text)
  );
}

export function detectIntent(message) {
  const text = (message || "").toLowerCase().trim();
  if (!text) return "unknown";
  if (isGreetingMessage(message)) return "greeting";
  if (isHelpMessage(message)) return "help";

  for (const rule of RULES) {
    if (rule.patterns.some((re) => re.test(text))) {
      return rule.intent;
    }
  }
  return "general";
}

export function extractMinutes(message, fallback = 60) {
  const text = (message || "").toLowerCase();
  if (/tất cả|toàn bộ|all time|từ đầu|since start|tổng thể|ever/.test(text)) return 0;
  if (/tháng này|thang nay|tháng hiện tại|thang hien tai|trong tháng( hiện tại| này| đang)?|tháng đang|thang dang/.test(text)) {
    return 43200;
  }
  const monthN = text.match(/(\d+)\s*tháng/);
  if (monthN) return Math.min(parseInt(monthN[1], 10) * 43200, 43200);
  if (/tháng qua|thang qua|trong\s+\d+\s*tháng\s*qua|\d+\s*tháng\s*qua/.test(text)) return 43200;
  if (/30\s*ngày|một tháng|1 tháng|trong 1 tháng|\bmonth\b/.test(text)) return 43200;
  const weekN = text.match(/(\d+)\s*tuần/);
  if (weekN) return Math.min(parseInt(weekN[1], 10) * 10080, 43200);
  if (/tuần qua|tuần này|trong tuần|7\s*ngày|một tuần|1 tuần|\bweek\b/.test(text)) return 10080;
  if (/hôm nay|today|cả ngày|24\s*h/.test(text)) return 1440;
  if (/hôm qua|yesterday/.test(text)) return 1440;
  if (/gần đây|vừa rồi|mới đây/.test(text)) return Math.min(fallback, 120);
  const m = text.match(/(\d+)\s*(phút|phut|minute|min)\b/i);
  if (m) return Math.min(parseInt(m[1], 10), 43200);
  // Vietnamese "giờ" — avoid \b after giờ (Unicode word boundary is unreliable in JS).
  const hVi = text.match(/(\d+)\s*giờ/i);
  if (hVi) return Math.min(parseInt(hVi[1], 10) * 60, 43200);
  const hEn = text.match(/(\d+)\s*(?:hours?|hrs?)\b/i);
  if (hEn) return Math.min(parseInt(hEn[1], 10) * 60, 43200);
  const d = text.match(/(\d+)\s*(ngày|day|d)\b/i);
  if (d) return Math.min(parseInt(d[1], 10) * 1440, 43200);
  return fallback;
}

/** views | purchases | revenue — for top product ranking. */
export function extractProductSort(message) {
  const text = (message || "").toLowerCase();
  if (/doanh thu|revenue|bán được nhiều tiền|kiếm nhiều|gmv/.test(text)) return "revenue";
  if (/mua.*(nhiều|nhất)|bán.*(nhiều|nhất)|được mua|purchase|bán chạy|best seller|hot nhất|đơn nhiều/.test(text)) {
    return "purchases";
  }
  if (/xem nhiều|view nhiều|traffic|lượt xem|quan tâm nhất/.test(text)) return "views";
  return "views";
}

/** User named an explicit time window in the message (not implicit fallback). */
export function hasExplicitTime(message) {
  const text = (message || "").toLowerCase();
  return /tuần|tháng|ngày|giờ|phút|hôm nay|hôm qua|hôm kia|gần đây|vừa rồi|mới đây|\d+\s*ngày\s*trước|\d+\s*(phút|minute|min|giờ|hour|h|ngày|day|d)\b/.test(
    text
  );
}

/** Short or referential follow-up that rules often miss without memory. */
export function isLikelyFollowUp(message) {
  const text = (message || "").trim();
  if (!text) return false;
  if (/đâu bạn|cho mình xem|xem thông tin|thông tin đi|chi tiết đi|xem đi\b/i.test(text)) {
    return true;
  }
  if (text.length <= 28) {
    return /^(thế|còn|vậy|rồi|ok|tiếp|và|còn|thế còn|thì sao|ra sao)/i.test(text);
  }
  if (text.length <= 55 && /^(vậy|thế|ok)\b/i.test(text)) {
    return true;
  }
  if (text.length <= 48 && /\b(thì sao|ra sao|thế nào)\s*$/i.test(text) && hasExplicitTime(message)) {
    return true;
  }
  if (text.length <= 55 && /^(giải thích|tại sao|vì sao|nguyên nhân)(\s+tại sao|\s+vậy|\s+đi)?\s*$/i.test(text)) {
    return true;
  }
  return (
    /^(còn|thế)\s.+\s(thì sao|ra sao|thế nào)/i.test(text) ||
    /\b(còn|thế)\s+(hôm qua|tuần|tháng|ngày)/i.test(text) ||
    /^trong\s+.+\s+(thì sao|ra sao|thế nào)\s*$/i.test(text)
  );
}

/** Extract product name from natural-language questions (not P001 ids). */
export function extractProductNameQuery(message) {
  let text = (message || "").trim();
  text = text.replace(/^(mình|tôi|cho|hỏi|về|muốn biết)\s+/gi, "").trim();

  const patterns = [
    /(?:chi tiết|thông tin|performance)\s+(?:sản phẩm|sp)\s+(.+)/i,
    /(?:phân tích|đánh giá|xem)\s+(?:sản phẩm|sp)\s+(.+)/i,
    /(?:sản phẩm|sp)\s+(.+?)\s+(?:thế nào|ra sao|performance|conversion|doanh thu|view|mua|bán)/i,
    /(?:sản phẩm|sp)\s+(.+)/i,
  ];

  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    let name = m[1].trim().replace(/[?.!]+$/g, "");
    name = name.replace(/\s+(trong|tuần|hôm|ngày|phút|giờ|gần đây|vừa rồi).*$/i, "").trim();
    if (name.length >= 3 && isConcreteProductName(name)) return name;
  }
  return null;
}

/** Exclude ranking/vague questions — not a specific product label. */
export function isConcreteProductName(name) {
  const n = (name || "").trim();
  if (n.length < 3) return false;
  if (/^(nào|cái nào|gì|đâu|which|what)\b/i.test(n)) return false;
  if (/nhiều nhất|ít nhất|bán chạy|hot nhất|top\b|được mua|được xem|đứng đầu/i.test(n)) return false;
  return true;
}

export function extractBannerNameQuery(message) {
  let text = (message || "").trim();
  const patterns = [
    /(?:chi tiết|thông tin)\s+banner\s+(.+)/i,
    /banner\s+(.+?)\s+(?:thế nào|ra sao|ctr|impression)/i,
    /banner\s+(.+)/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (!m?.[1]) continue;
    let name = m[1].trim().replace(/[?.!]+$/g, "");
    if (name.length >= 2) return name;
  }
  return null;
}

/** @deprecated import from static-intents.js — kept for tests importing from intent.js */
export { isGreetingMessage, GREETING_REPLY } from "./static-intents.js";
