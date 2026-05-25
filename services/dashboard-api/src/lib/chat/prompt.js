function fmt(n) { return Number(n || 0).toLocaleString("vi-VN"); }
function money(n) { return `${fmt(n)} ₫`; }
function pct(r) { return `${(Number(r || 0) * 100).toFixed(2)}%`; }

/**
 * Build system + user prompt từ intent + data thật từ PostgreSQL.
 * Số liệu embed trực tiếp vào prompt — model chỉ diễn đạt lại.
 */
export function buildPrompt(intent, { minutes, data, ragHits = [] }) {
  const system = `Bạn là trợ lý phân tích hành vi người dùng cho website thương mại điện tử.
Trả lời bằng tiếng Việt, súc tích, không quá 250 từ.
Chỉ dựa vào số liệu được cung cấp — KHÔNG tự bịa số liệu.
Nếu số liệu bằng 0 hoặc thiếu, nói rõ chưa có dữ liệu.`;

  let dataBlock = "";

  switch (intent) {
    case "overview":
    case "sessions":
    case "revenue":
    case "general": {
      const k = data.kpi || {};
      dataBlock = `SỐ LIỆU (${minutes} phút gần nhất, từ PostgreSQL):
- Sessions: ${fmt(k.unique_sessions)}
- Page views: ${fmt(k.page_views)} | Product views: ${fmt(k.product_views)}
- Thêm giỏ: ${fmt(k.add_to_cart)} | Checkout: ${fmt(k.checkout_start)} | Đơn mua: ${fmt(k.purchases)}
- Doanh thu: ${money(k.total_revenue)}
- Tỷ lệ chuyển đổi: ${pct(k.conversion_rate)}
- Tổng events: ${fmt(k.total_events)}`;
      break;
    }

    case "top_products": {
      const list = (data.products || []).slice(0, 5)
        .map((p, i) => `  ${i + 1}. ${p.product_name} (${p.product_id}): ${fmt(p.views)} view, ${fmt(p.purchases)} mua, ${money(p.revenue)}`)
        .join("\n");
      dataBlock = `TOP SẢN PHẨM (${minutes} phút, từ PostgreSQL):\n${list || "  (chưa có dữ liệu)"}`;
      break;
    }

    case "product_anomaly": {
      const list = (data.anomalies || []).slice(0, 5)
        .map((p) => `  - ${p.product_name} (${p.product_id}): ${fmt(p.views)} view, ${fmt(p.clicks)} click, 0 mua`)
        .join("\n");
      dataBlock = `SẢN PHẨM NHIỀU VIEW - 0 MUA (${minutes} phút, từ PostgreSQL):\n${list || "  (không có anomaly)"}`;
      if (ragHits.length) {
        dataBlock += `\n\nINSIGHT TỪ QDRANT:\n${ragHits.map((h) => `  - ${h.text}`).join("\n")}`;
      }
      break;
    }

    case "funnel": {
      const steps = data.steps || data.funnel?.steps || [];
      const lines = steps.map(
        (s) => `  - ${s.label || s.step}: ${fmt(s.count)}${s.drop_off_rate > 0 ? ` (rớt ${(s.drop_off_rate * 100).toFixed(1)}%)` : ""}`
      ).join("\n");
      dataBlock = `FUNNEL CHUYỂN ĐỔI (${minutes} phút, từ PostgreSQL):\n${lines || "  (chưa có dữ liệu)"}`;
      break;
    }

    case "banner": {
      const list = (data.banners || []).slice(0, 5)
        .map((b) => `  - ${b.banner_id}: ${fmt(b.impressions)} impression, ${fmt(b.clicks)} click, CTR ${(Number(b.ctr) * 100).toFixed(2)}%`)
        .join("\n");
      dataBlock = `HIỆU SUẤT BANNER (${minutes} phút, từ PostgreSQL):\n${list || "  (chưa có dữ liệu banner)"}`;
      break;
    }

    case "optimize": {
      const k = data.kpi || {};
      const anomalies = (data.anomalies || []).slice(0, 3).map((p) => `  - ${p.product_name}: ${fmt(p.views)} view, 0 mua`).join("\n");
      const steps = (data.steps || []);
      const worstStep = steps.reduce((w, s) => (!w || s.drop_off_rate > w.drop_off_rate) ? s : w, null);
      dataBlock = `SỐ LIỆU ĐỂ GỢI Ý TỐI ƯU (${minutes} phút):\n- Conversion rate: ${pct(k.conversion_rate)}\n- Doanh thu: ${money(k.total_revenue)}\nSản phẩm high-view/low-purchase:\n${anomalies || "  (không có)"}\nBước funnel rớt nhiều nhất: ${worstStep?.label || "chưa rõ"} (${((worstStep?.drop_off_rate || 0) * 100).toFixed(1)}%)`;
      if (ragHits.length) {
        dataBlock += `\nInsight Qdrant:\n${ragHits.map((h) => `  - ${h.text}`).join("\n")}`;
      }
      break;
    }

    default: {
      const k = data.kpi || {};
      dataBlock = `SNAPSHOT (${minutes} phút): sessions=${fmt(k.unique_sessions)}, mua=${fmt(k.purchases)}, doanh thu=${money(k.total_revenue)}`;
    }
  }

  const userPrompt = `${dataBlock}\n\nCÂU HỎI: ${_intentQuestion(intent)}\n\nHãy phân tích và trả lời ngắn gọn bằng tiếng Việt:`;

  return `${system}\n\n${userPrompt}`;
}

function _intentQuestion(intent) {
  const MAP = {
    overview: "Tóm tắt tình hình website hiện tại.",
    top_products: "Top sản phẩm được xem nhiều nhất là gì?",
    product_anomaly: "Sản phẩm nào nhiều view nhưng không có đơn mua? Gợi ý nguyên nhân.",
    funnel: "Người dùng rớt nhiều nhất ở bước nào? Nhận xét về phễu chuyển đổi.",
    sessions: "Hiện có bao nhiêu session đang hoạt động? Đánh giá mức độ traffic.",
    revenue: "Tóm tắt tình hình doanh thu. Nhận xét về hiệu quả bán hàng.",
    banner: "Đánh giá hiệu suất banner. Banner nào tốt, banner nào cần cải thiện?",
    optimize: "Đề xuất 3-5 hành động cụ thể để cải thiện tỷ lệ chuyển đổi.",
    general: "Phân tích tình hình và trả lời câu hỏi của người dùng.",
  };
  return MAP[intent] || MAP.general;
}
