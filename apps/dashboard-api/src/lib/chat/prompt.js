function fmt(n) {
  return Number(n || 0).toLocaleString("vi-VN");
}
function money(n) {
  return `${fmt(n)} ₫`;
}
function pct(r) {
  return `${(Number(r || 0) * 100).toFixed(2)}%`;
}

const SYSTEM_PROMPT = `Bạn là Analytics Assistant cho cửa hàng TMĐT — giọng thân thiện, như đồng nghiệp BI.

Quy tắc số liệu:
- CHỈ dùng số trong khối "DỮ LIỆU" — không bịa số, %, tên sản phẩm.
- Nếu thiếu hoặc = 0: nói rõ và gợi ý chờ traffic / kiểm tra web-shop.
- Phân biệt **dữ kiện** (có số) vs **giả thuyết** (đoán nguyên nhân).

Cấu trúc trả lời (ưu tiên, bỏ phần không liên quan):
1. **Kết luận nhanh** — 1–2 câu trả lời trực tiếp câu hỏi.
2. **Bằng chứng** — số liệu chính (gạch đầu dòng).
3. **Điểm nghẽn / vấn đề** — nếu có trong dữ liệu (funnel rớt, SP xem nhiều không mua, banner kém).
4. **Gợi ý hành động** — 1–2 việc cụ thể, khả thi (ưu tiên theo impact).
5. **Độ tin cậy** — "cao" nếu nhiều số liệu khớp; "trung bình/thấp" nếu dữ liệu mỏng.

Ngôn ngữ: tiếng Việt, dễ đọc.`;

/**
 * Build system + user messages for Ollama /api/chat.
 * userMessage = câu hỏi gốc (ngôn ngữ tự nhiên), không thay bằng template.
 */
function formatActionsForPrompt(actions) {
  if (!actions?.length) return "";
  return actions
    .map(
      (a) =>
        `  - [${a.priority}] ${a.title}: ${a.suggestion} (confidence ${(a.confidence * 100).toFixed(0)}%)`
    )
    .join("\n");
}

export function buildChatMessages(
  intent,
  { minutes, data, ragHits = [], userMessage = "", rewritten = false, actions = [] }
) {
  const dataBlock = buildDataBlock(intent, { minutes, data, ragHits });
  const actionsBlock = formatActionsForPrompt(actions);
  const question = (userMessage || "").trim() || _intentFallbackQuestion(intent);

  const rewriteNote = rewritten
    ? "\n(Lưu ý: câu hỏi gốc có thể nhắm cá nhân — chỉ trả thống kê tổng hợp, không danh sách user/session.)\n"
    : "";

  const actionsSection = actionsBlock
    ? `\nGỢI Ý HÀNH ĐỘNG (đã tính từ engine, có thể tóm tắt trong mục 4):\n${actionsBlock}\n`
    : "";

  const userContent = `DỮ LIỆU (PostgreSQL, ${minutes} phút gần nhất):
${dataBlock}
${actionsSection}${rewriteNote}
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

    case "comparison": {
      const c = data.comparison || {};
      const cur = c.current || {};
      const prev = c.previous || {};
      const d = c.delta || {};
      return `SO SÁNH KPI (kỳ hiện tại vs kỳ trước, cùng ${minutes} phút):
  - Sessions: ${fmt(cur.unique_sessions)} vs ${fmt(prev.unique_sessions)} (${pctSigned(d.sessions_pct)})
  - Đơn mua: ${fmt(cur.purchases)} vs ${fmt(prev.purchases)} (${pctSigned(d.purchases_pct)})
  - Doanh thu: ${money(cur.total_revenue)} vs ${money(prev.total_revenue)} (${pctSigned(d.revenue_pct)})
  - Conversion: ${pct(cur.conversion_rate)} vs ${pct(prev.conversion_rate)}`;
    }

    case "trend": {
      const rows = (data.trend || []).slice(-12);
      const lines = rows
        .map((r) => `  - ${r.window_start}: ${money(r.revenue)}, ${fmt(r.purchases)} đơn`)
        .join("\n");
      return `XU HƯỚNG DOANH THU (theo cửa sổ 1 phút):\n${lines || "  (chưa có)"}`;
    }

    case "product_conversion": {
      const list = (data.product_conversion || [])
        .slice(0, 8)
        .map(
          (p, i) =>
            `  ${i + 1}. ${p.product_name}: conversion ${pct(p.conversion_rate)}, ${fmt(p.views)} view, ${fmt(p.purchases)} mua`
        )
        .join("\n");
      return `CONVERSION THEO SẢN PHẨM:\n${list || "  (chưa có)"}`;
    }

    case "product_anomaly": {
      const list = (data.anomalies || [])
        .slice(0, 8)
        .map(
          (p) =>
            `  - ${p.product_name} (${p.product_id}): ${fmt(p.views)} view, severity ${Number(p.severity_score || 0).toFixed(1)}`
        )
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

function pctSigned(r) {
  const n = Number(r || 0) * 100;
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function _intentFallbackQuestion(intent) {
  const MAP = {
    comparison: "So sánh KPI kỳ này với kỳ trước.",
    trend: "Xu hướng doanh thu gần đây?",
    product_conversion: "Sản phẩm nào có conversion tốt nhất?",
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
