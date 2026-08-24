/** Blocked: PII / raw data / credentials — never query DB or Qdrant. */
const BLOCKED_KEYWORDS = [
  "email",
  "số điện thoại",
  "so dien thoai",
  "phone",
  "địa chỉ",
  "dia chi",
  "address",
  "password",
  "token",
  "api key",
  "apikey",
  "session_id",
  "user_id",
  "userid",
  "danh sách khách",
  "danh sach khach",
  "lịch sử mua hàng",
  "lich su mua hang",
  "raw event",
  "bảng users",
  "bang users",
  "bảng orders",
  "bang orders",
  "xuất file",
  "export csv",
  "dump database",
];

const SENSITIVE_PATTERNS = [
  /\b[\w.-]+@[\w.-]+\.\w+\b/i,
  /\b0\d{9,10}\b/,
  /\b\d{1,3}(\.\d{1,3}){3}\b/,
  /\b(session|user)[_-]?id\s*[:=]?\s*[\w-]+/i,
  /\b(cho|gửi|gui|đưa|dua)\s+(tôi|toi)\s+email\b/i,
];

/** Rewrite: câu hỏi cá nhân → chỉ trả thống kê tổng hợp. */
const REWRITE_PATTERNS = [
  { re: /user nào|khách nào|ai (đã|đang)|người nào/i, intent: "funnel" },
  { re: /session nào|phiên nào/i, intent: "sessions" },
  { re: /bỏ giỏ|bo gio/i, intent: "funnel" },
  { re: /ai (mua|đặt)|khách (mua|đặt)/i, intent: "revenue" },
];

const SAFE_REFUSAL =
  "Mình không thể truy xuất hoặc hiển thị dữ liệu cá nhân/nhạy cảm (email, số điện thoại, user/session ID, raw event). " +
  "Mình có thể hỗ trợ ở mức **thống kê tổng hợp**: doanh thu, số đơn, tỷ lệ chuyển đổi, top sản phẩm, phễu funnel, hiệu quả banner.";

const REWRITE_NOTE =
  "_Câu hỏi đã được chuyển sang thống kê tổng hợp (không trả danh sách cá nhân)._";

export { REWRITE_NOTE, SAFE_REFUSAL };

/**
 * @returns {{ decision: "allow"|"deny"|"rewrite", reason: string, safeAnswer?: string, suggestedIntent?: string }}
 */
export function classifyScope(message) {
  const text = String(message || "").toLowerCase().trim();
  if (!text) {
    return { decision: "allow", reason: "empty_message" };
  }

  const keywordHit = BLOCKED_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
  const patternHit = SENSITIVE_PATTERNS.some((re) => re.test(message));
  if (keywordHit || patternHit) {
    return {
      decision: "deny",
      reason: keywordHit ? "blocked_keyword" : "sensitive_pattern",
      safeAnswer: SAFE_REFUSAL,
    };
  }

  for (const { re, intent } of REWRITE_PATTERNS) {
    if (re.test(message)) {
      return {
        decision: "rewrite",
        reason: "individual_to_aggregate",
        suggestedIntent: intent,
      };
    }
  }

  return { decision: "allow", reason: "safe_analytics_request" };
}
