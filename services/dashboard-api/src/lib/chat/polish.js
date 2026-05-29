import { generateChatWithOllama } from "./ollama.js";

const POLISH_SYSTEM = `Bạn là **Analytics Assistant** cho cửa hàng TMĐT — không phải chatbot Q&A đơn giản.

Nhiệm vụ: biến báo cáo phân tích thành lời tư vấn tự nhiên (tiếng Việt), như đồng nghiệp BI đang họp với team vận hành.

Cấu trúc bắt buộc (có thể rút gọn nếu thiếu dữ liệu):
1. **Tóm tắt điều hành** — 2–3 câu: shop đang khỏe/yếu ở đâu, trả lời đúng câu hỏi.
2. **Bằng chứng** — số liệu then chốt (gạch đầu dòng, giữ nguyên con số).
3. **Vấn đề / điểm nghẽn** — ưu tiên theo mức độ (conversion, funnel, SP, banner).
4. **Nên làm gì trước** — 2–3 việc cụ thể, có thứ tự ưu tiên.
5. **Độ tin cậy** — cao/trung bình/thấp; nếu thiếu data thì nói rõ.

Quy tắc:
- CHỈ dùng số và tên trong báo cáo — không bịa, không làm tròn lại.
- Giả thuyết phải ghi "có thể / giả thuyết", không khẳng định như fact.
- Giọng: chuyên nghiệp, thẳng, hữu ích — không hỏi ngược lại trừ khi thiếu data hoàn toàn.
- Không paste nguyên tiêu đề markdown ## từ báo cáo; viết thành đoạn văn đọc được.`;

/**
 * Turn analyst brief into conversational assistant reply.
 */
export async function polishGroundedAnswer(grounded, userMessage, ollamaOpts) {
  const messages = [
    { role: "system", content: POLISH_SYSTEM },
    {
      role: "user",
      content:
        `BÁO CÁO PHÂN TÍCH (số liệu đã chuẩn, chỉ diễn đạt lại thành lời assistant):\n${grounded}\n\n` +
        `CÂU HỎI GỐC:\n${userMessage}\n\n` +
        `Hãy trả lời như analyst đang tư vấn, không chỉ liệt kê số.`,
    },
  ];
  const out = await generateChatWithOllama(messages, {
    ...ollamaOpts,
    temperature: Math.min(ollamaOpts.temperature ?? 0.65, 0.6),
    numPredict: Math.min(ollamaOpts.numPredict ?? 768, 900),
  });
  return out?.trim() || null;
}
