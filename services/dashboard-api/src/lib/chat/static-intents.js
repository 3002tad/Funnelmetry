export const GREETING_REPLY =
  "Chào! Mình là trợ lý **phân tích shop** — hỏi bằng tiếng Việt, mình trả lời dựa trên số liệu pipeline.\n\n" +
  "Thử ngay: *tổng quan 60 phút qua*, *doanh thu hôm nay*, hoặc *phễu đang rớt ở đâu?*\n\n" +
  "Gõ **help** để xem thêm gợi ý câu hỏi.";

export const HELP_REPLY =
  "Mình giúp bạn **đọc KPI shop** (doanh thu, phễu, sản phẩm, banner…). Chỉ số tổng hợp — không tra thông tin cá nhân khách.\n\n" +
  "**Gợi ý câu hỏi:**\n" +
  "- Tình hình shop / tổng quan hôm nay\n" +
  "- Doanh thu 24h hoặc tuần qua\n" +
  "- Bao nhiêu session / lượt truy cập\n" +
  "- Top sản phẩm bán chạy hoặc xem nhiều không mua\n" +
  "- Chi tiết sản phẩm P001 (hoặc gõ tên SP)\n" +
  "- Phễu chuyển đổi / bỏ giỏ ở bước nào\n" +
  "- CTR banner, so sánh với kỳ trước\n" +
  "- Nên tối ưu gì trước để tăng conversion\n\n" +
  "Thêm mốc thời gian: *2 giờ*, *60 phút*, *hôm nay*, *tuần qua*.";

export const THANKS_REPLY =
  "Không có gì! Hỏi thêm KPI bất cứ lúc nào — ví dụ doanh thu hôm nay hoặc top sản phẩm tuần qua.";

export const GOODBYE_REPLY = "Tạm biệt! Quay lại khi cần xem số liệu shop nhé.";

export const OFF_TOPIC_REPLY =
  "Mình chỉ hỗ trợ **phân tích shop demo** (doanh thu, session, sản phẩm, phễu, banner, insight pipeline).\n\n" +
  "Thử: *\"doanh thu hôm nay\"*, *\"top sản phẩm tuần qua\"*, hoặc gõ **help**.";

const ANALYTICS_HINT =
  /doanh thu|revenue|session|phiên|traffic|sản phẩm|\bsp\b|phễu|funnel|banner|conversion|insight|qdrant|shop|cửa hàng|mua|bán|view|top|so sánh|tối ưu|giỏ|cart|checkout|ctr|gmv|đơn|khách|visitor|tuần|hôm nay|hôm qua|phút|giờ|ngày|tình hình|tổng quan|chi tiết|anomaly|hot|bán chạy|rớt|drop|hero|promo|xu hướng|trend|catalog|p\d{3}|tìm kiếm|search|filter|danh mục|category|aov|pageview|event/i;

export function isAckMessage(message) {
  const text = (message || "").trim();
  if (!text || text.length > 24) return false;
  const n = text.replace(/[!?.]+$/g, "").trim();
  return /^(ok|oke|okay|được|dc|hiểu rồi|got it|roger|👍)$/i.test(n);
}

export const ACK_REPLY = "Ok! Hỏi tiếp KPI shop bất cứ lúc nào nhé.";

export function isGreetingMessage(message) {
  const text = (message || "").trim();
  if (!text || text.length > 48) return false;
  const normalized = text.replace(/[!?.。，]+$/g, "").trim();
  return /^(hello|hi|hey|yo|alo|helo|hallo|chào|xin chào|hế lô|chào bạn|chào anh|chào chị|hi there|hello there|good morning|good afternoon|good evening)$/i.test(
    normalized
  );
}

export function isHelpMessage(message) {
  const text = (message || "").trim();
  if (!text || text.length > 120) return false;
  return (
    /^(help|\?|hướng dẫn|giúp tôi|giúp mình)$/i.test(text.replace(/[!?.]+$/g, "")) ||
    /bạn là ai|bạn là gì|bạn làm (được )?gì|làm được gì|hỏi gì|gợi ý câu hỏi|chức năng|capabilities|hỗ trợ gì|có thể hỏi/i.test(text)
  );
}

export function isThanksMessage(message) {
  const text = (message || "").trim();
  if (!text || text.length > 60) return false;
  const n = text.replace(/[!?.。，]+$/g, "").trim();
  return (
    /^(cảm ơn|cam on|thanks|thank you|tks|ok cảm ơn|cám ơn)$/i.test(n) ||
    /^cảm ơn (bạn|nhiều|bn)/i.test(text)
  );
}

export function isGoodbyeMessage(message) {
  const text = (message || "").trim();
  if (!text || text.length > 40) return false;
  const n = text.replace(/[!?.]+$/g, "").trim();
  return /^(bye|goodbye|tạm biệt|tam biet|see you|hẹn gặp lại|bb)$/i.test(n);
}

export function isExplicitOffTopic(message) {
  const text = (message || "").toLowerCase();
  if (text.length > 200) return false;
  return /thời tiết|weather|bóng đá|chính trị|nấu ăn|viết code|python|javascript|react|node\.?js|tình yêu|xem phim|chơi game|chatgpt|gpt-4|openai/i.test(
    text
  );
}

function isShortFollowUp(message) {
  const text = (message || "").trim();
  return text.length <= 28 && /^(thế|còn|vậy|ok|tiếp|rồi|thì sao|ra sao)/i.test(text);
}

export function isLikelyAnalyticsQuestion(message) {
  const text = (message || "").trim();
  if (!text) return false;
  return ANALYTICS_HINT.test(text);
}

/**
 * @param {string} message
 * @param {boolean} isGeneralIntent — from detectIntent(message) === "general"
 */
export function detectStaticIntent(message, memory = null, isGeneralIntent = false) {
  if (isAckMessage(message)) return { intent: "ack", reply: ACK_REPLY };
  if (isGreetingMessage(message)) return { intent: "greeting", reply: GREETING_REPLY };
  if (isHelpMessage(message)) return { intent: "help", reply: HELP_REPLY };
  if (isThanksMessage(message)) return { intent: "thanks", reply: THANKS_REPLY };
  if (isGoodbyeMessage(message)) return { intent: "goodbye", reply: GOODBYE_REPLY };
  if (isExplicitOffTopic(message)) return { intent: "off_topic", reply: OFF_TOPIC_REPLY };

  if (isGeneralIntent && !isLikelyAnalyticsQuestion(message)) {
    if (memory?.last_intent && isShortFollowUp(message)) return null;
    return { intent: "off_topic", reply: OFF_TOPIC_REPLY };
  }
  return null;
}

export const STATIC_INTENT_NAMES = new Set([
  "greeting",
  "help",
  "thanks",
  "goodbye",
  "ack",
  "off_topic",
]);
