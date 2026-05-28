function fmt(n) {
  return Number(n || 0).toLocaleString("vi-VN");
}
function money(n) {
  return `${fmt(n)} ₫`;
}
function pct(r) {
  return `${(Number(r || 0) * 100).toFixed(2)}%`;
}

const SYSTEM_PROMPT = `Bạn là trợ lý phân tích cửa hàng TMĐT — giọng thân thiện, tự nhiên như đồng nghiệp BI đang trò chuyện.

Quy tắc:
- Trả lời bằng tiếng Việt, dễ đọc; có thể dùng gạch đầu dòng khi liệt kê.
- CHỈ dùng số liệu trong khối "DỮ LIỆU" — không tự bịa số, %, tên sản phẩm.
- Nếu thiếu dữ liệu hoặc = 0, nói thẳng và gợi ý chờ thêm traffic / kiểm tra web-shop.
- Trả lời đúng trọng tâm câu hỏi của người dùng; có thể hỏi lại ngắn nếu câu hỏi mơ hồ.
- Kết thúc bằng 1–2 gợi ý hành động cụ thể khi phù hợp (không bắt buộc mọi câu).`;

/**
 * Build system + user messages for Ollama /api/chat.
 * userMessage = câu hỏi gốc (ngôn ngữ tự nhiên), không thay bằng template.
 */
export function buildChatMessages(intent, { minutes, data, ragHits = [], userMessage = "" }) {
  const dataBlock = buildDataBlock(intent, { minutes, data, ragHits });
  const question = (userMessage || "").trim() || _intentFallbackQuestion(intent);

  const userContent = `DỮ LIỆU (PostgreSQL, ${minutes} phút gần nhất):
${dataBlock}

CÂU HỎI CỦA NGƯỜI DÙNG:
${question}`;

  return [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: userContent },
  ];
}

/** Legacy single-string prompt (template fallback path). */
export function buildPrompt(intent, ctx) {
  const messages = buildChatMessages(intent, ctx);
  return `${messages[0].content}\n\n${messages[1].content}`;
}

function buildDataBlock(intent, { minutes, data, ragHits }) {
  switch (intent) {
    case "overview":
    case "sessions":
    case "revenue":
    case "general": {
      const k = data.kpi || {};
      return `- Sessions: ${fmt(k.unique_sessions)}
- Page views: ${fmt(k.page_views)} | Product views: ${fmt(k.product_views)}
- Thêm giỏ: ${fmt(k.add_to_cart)} | Checkout: ${fmt(k.checkout_start)} | Đơn mua: ${fmt(k.purchases)}
- Doanh thu: ${money(k.total_revenue)}
- Tỷ lệ chuyển đổi: ${pct(k.conversion_rate)}
- Tổng events: ${fmt(k.total_events)}`;
    }

    case "top_products": {
      const list = (data.products || [])
        .slice(0, 8)
        .map(
          (p, i) =>
            `  ${i + 1}. ${p.product_name} (${p.product_id}): ${fmt(p.views)} view, ${fmt(p.purchases)} mua, ${money(p.revenue)}`
        )
        .join("\n");
      return `TOP SẢN PHẨM:\n${list || "  (chưa có dữ liệu)"}`;
    }

    case "product_anomaly": {
      const list = (data.anomalies || [])
        .slice(0, 8)
        .map((p) => `  - ${p.product_name} (${p.product_id}): ${fmt(p.views)} view, ${fmt(p.clicks)} click, 0 mua`)
        .join("\n");
      let block = `SẢN PHẨM NHIỀU VIEW - ÍT/KHÔNG MUA:\n${list || "  (không có anomaly)"}`;
      if (ragHits.length) {
        block += `\n\nINSIGHT QDRANT:\n${ragHits.map((h) => `  - ${h.text}`).join("\n")}`;
      }
      return block;
    }

    case "funnel": {
      const steps = data.steps || data.funnel?.steps || [];
      const lines = steps
        .map(
          (s) =>
            `  - ${s.label || s.step}: ${fmt(s.count)}${s.drop_off_rate > 0 ? ` (rớt ${(s.drop_off_rate * 100).toFixed(1)}%)` : ""}`
        )
        .join("\n");
      return `PHỄU CHUYỂN ĐỔI:\n${lines || "  (chưa có dữ liệu)"}`;
    }

    case "banner": {
      const list = (data.banners || [])
        .slice(0, 8)
        .map(
          (b) =>
            `  - ${b.banner_id}: ${fmt(b.impressions)} impression, ${fmt(b.clicks)} click, CTR ${(Number(b.ctr) * 100).toFixed(2)}%`
        )
        .join("\n");
      return `BANNER:\n${list || "  (chưa có dữ liệu)"}`;
    }

    case "optimize": {
      const k = data.kpi || {};
      const anomalies = (data.anomalies || [])
        .slice(0, 5)
        .map((p) => `  - ${p.product_name}: ${fmt(p.views)} view, 0 mua`)
        .join("\n");
      const steps = data.steps || [];
      const worstStep = steps.reduce(
        (w, s) => (!w || s.drop_off_rate > w.drop_off_rate ? s : w),
        null
      );
      let block = `KPI: conversion ${pct(k.conversion_rate)}, doanh thu ${money(k.total_revenue)}
Sản phẩm high-view/low-purchase:
${anomalies || "  (không có)"}
Bước funnel rớt nhiều: ${worstStep?.label || "chưa rõ"} (${((worstStep?.drop_off_rate || 0) * 100).toFixed(1)}%)`;
      if (ragHits.length) {
        block += `\nInsight Qdrant:\n${ragHits.map((h) => `  - ${h.text}`).join("\n")}`;
      }
      return block;
    }

    default: {
      const k = data.kpi || {};
      return `Snapshot: sessions=${fmt(k.unique_sessions)}, mua=${fmt(k.purchases)}, doanh thu=${money(k.total_revenue)}`;
    }
  }
}

function _intentFallbackQuestion(intent) {
  const MAP = {
    overview: "Tóm tắt tình hình website hiện tại.",
    top_products: "Top sản phẩm được xem nhiều nhất?",
    product_anomaly: "Sản phẩm nào nhiều view nhưng ít mua?",
    funnel: "Người dùng rớt nhiều ở bước nào trong phễu?",
    sessions: "Có bao nhiêu session / traffic?",
    revenue: "Tình hình doanh thu thế nào?",
    banner: "Banner nào hiệu quả, banner nào kém?",
    optimize: "Gợi ý cải thiện conversion.",
    general: "Phân tích tình hình cửa hàng.",
  };
  return MAP[intent] || MAP.general;
}
