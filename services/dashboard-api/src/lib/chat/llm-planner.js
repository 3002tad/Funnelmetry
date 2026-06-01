import { generateChatWithOllama } from "./ollama.js";

export const VALID_INTENTS = new Set([
  "overview",
  "top_products",
  "product_anomaly",
  "optimize",
  "funnel",
  "sessions",
  "revenue",
  "banner",
  "comparison",
  "trend",
  "product_conversion",
  "product_detail",
  "insights",
  "cart_abandon",
  "conversion",
  "search",
  "filters",
  "category",
  "orders",
  "recent_purchases",
  "aov",
  "pageviews",
  "events",
  "catalog",
  "checkout",
  "banner_detail",
  "general",
]);

export const VALID_SORTS = new Set(["views", "purchases", "revenue"]);

const PLANNER_SYSTEM = `Bạn phân loại câu hỏi analytics cửa hàng TMĐT. Trả về ĐÚNG 1 JSON object (không markdown, không giải thích).
Trường bắt buộc:
- intent: overview|top_products|product_anomaly|optimize|funnel|sessions|revenue|banner|comparison|trend|product_conversion|product_detail|insights|cart_abandon|conversion|search|filters|category|orders|aov|pageviews|events|catalog|checkout|banner_detail|general
- minutes: cửa sổ thời gian (60=1h, 120=2h, 1440=1 ngày, 10080=7 ngày)
- product_sort: views|purchases|revenue hoặc null (chỉ khi hỏi top/ranking sản phẩm)
- is_followup: true nếu câu ngắn/mơ hồ tham chiếu câu trước ("còn hôm qua", "thế tuần trước")

Ví dụ:
{"intent":"revenue","minutes":1440,"product_sort":null,"is_followup":false}
{"intent":"top_products","minutes":10080,"product_sort":"purchases","is_followup":false}
{"intent":"general","minutes":1440,"product_sort":null,"is_followup":true}`;

/**
 * Parse JSON planner output; tolerate fenced blocks from small models.
 */
export function parseLlmPlanResponse(raw) {
  if (!raw || typeof raw !== "string") return null;
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) text = fenced[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

/**
 * @param {unknown} parsed
 * @returns {{ intent: string, minutes: number, product_sort: string|null, is_followup: boolean }|null}
 */
export function normalizeLlmSlots(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const intent = String(parsed.intent || "").trim();
  if (!VALID_INTENTS.has(intent)) return null;

  const minutesRaw = Number(parsed.minutes);
  const minutes =
    Number.isFinite(minutesRaw) && minutesRaw >= 15 && minutesRaw <= 10080
      ? Math.round(minutesRaw)
      : null;

  let product_sort = parsed.product_sort;
  if (product_sort != null) {
    product_sort = String(product_sort).trim();
    if (!VALID_SORTS.has(product_sort)) product_sort = null;
  }

  return {
    intent,
    minutes,
    product_sort: product_sort || null,
    is_followup: Boolean(parsed.is_followup),
  };
}

/**
 * Ollama slot extraction — short timeout, low temperature; returns null on failure.
 */
export async function tryLlmPlanSlots(message, { memory, ollamaOpts } = {}) {
  if (!ollamaOpts?.baseUrl || !ollamaOpts?.model) return null;

  const contextLines = [];
  if (memory?.last_intent) {
    contextLines.push(
      `Câu trước: intent=${memory.last_intent}, minutes=${memory.last_minutes ?? 60}` +
        (memory.last_product_sort ? `, sort=${memory.last_product_sort}` : "")
    );
  }
  if (memory?.last_message) {
    contextLines.push(`Nội dung trước: ${memory.last_message}`);
  }

  const userContent = [
    contextLines.length ? contextLines.join("\n") : null,
    `Câu hỏi hiện tại: ${message}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const raw = await generateChatWithOllama(
    [
      { role: "system", content: PLANNER_SYSTEM },
      { role: "user", content: userContent },
    ],
    {
      model: ollamaOpts.model,
      baseUrl: ollamaOpts.baseUrl,
      timeout: ollamaOpts.plannerTimeout ?? 12_000,
      temperature: 0.05,
      numPredict: 160,
    }
  );

  const parsed = parseLlmPlanResponse(raw);
  const slots = normalizeLlmSlots(parsed);
  if (!slots) {
    console.warn("chat: LLM planner returned invalid JSON:", raw?.slice(0, 120));
  }
  return slots;
}
