import { formatActionsMarkdown } from "./action.engine.js";

function fmt(n) {
  return Number(n || 0).toLocaleString("vi-VN");
}

function fmtMoney(n) {
  return `${fmt(n)} ₫`;
}

function pct(rate) {
  return `${(Number(rate) * 100).toFixed(2)}%`;
}

function pctSigned(r) {
  const n = Number(r || 0) * 100;
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function withActions(text, actions) {
  if (!actions?.length || text.includes("Action cards")) return text;
  return text + formatActionsMarkdown(actions);
}

export function formatAnswer(intent, { minutes, data, ragHits = [], rewritten = false, actions = [] }) {
  const period = `trong ${minutes} phút gần nhất`;

  switch (intent) {
    case "comparison": {
      const c = data.comparison || {};
      const d = c.delta || {};
      return withActions(
        `**So sánh ${period}** (vs kỳ trước cùng độ dài):\n\n` +
          `- **Sessions:** ${pctSigned(d.sessions_pct)}\n` +
          `- **Đơn mua:** ${pctSigned(d.purchases_pct)}\n` +
          `- **Doanh thu:** ${pctSigned(d.revenue_pct)}\n` +
          `- **Conversion:** ${((d.conversion_delta || 0) * 100).toFixed(2)} điểm %`,
        actions
      );
    }

    case "trend": {
      const rows = (data.trend || []).slice(-6);
      const lines = rows.map((r) => `- ${r.window_start}: ${fmtMoney(r.revenue)}`).join("\n");
      return withActions(
        `**Xu hướng doanh thu ${period}:**\n\n${lines || "_Chưa có cửa sổ KPI._"}`,
        actions
      );
    }

    case "product_conversion": {
      const lines = (data.product_conversion || [])
        .slice(0, 5)
        .map(
          (p, i) =>
            `${i + 1}. **${p.product_name}** — conversion ${pct(p.conversion_rate)}, ${fmt(p.views)} view`
        );
      return withActions(
        `**Conversion theo sản phẩm ${period}:**\n\n${lines.join("\n") || "_Chưa có dữ liệu._"}`,
        actions
      );
    }

    case "overview": {
      const k = data.kpi || {};
      return withActions(
        `**Tóm tắt ${period}** (số liệu từ PostgreSQL):\n\n` +
        `- **Sessions:** ${fmt(k.unique_sessions)}\n` +
        `- **Page views:** ${fmt(k.page_views)} · **Product views:** ${fmt(k.product_views)}\n` +
        `- **Thêm giỏ:** ${fmt(k.add_to_cart)} · **Checkout:** ${fmt(k.checkout_start)} · **Đơn mua:** ${fmt(k.purchases)}\n` +
        `- **Doanh thu:** ${fmtMoney(k.total_revenue)}\n` +
        `- **Tỷ lệ chuyển đổi (mua/session):** ${pct(k.conversion_rate)}\n` +
        `- **Tổng events:** ${fmt(k.total_events)}\n\n` +
          `**Độ tin cậy:** ${Number(k.total_events) > 0 ? "cao" : "thấp — cần thêm event từ web-shop"}.`,
        actions
      );
    }

    case "top_products": {
      const lines = (data.products || []).map(
        (p, i) =>
          `${i + 1}. **${p.product_name}** (${p.product_id}) — ${fmt(p.views)} view, ${fmt(p.purchases)} mua, ${fmtMoney(p.revenue)}`
      );
      return (
        `**Top sản phẩm theo lượt xem ${period}:**\n\n` +
        (lines.length ? lines.join("\n") : "_Chưa có dữ liệu sản phẩm trong khoảng thời gian này._")
      );
    }

    case "product_anomaly": {
      const lines = (data.anomalies || []).map(
        (p) =>
          `- **${p.product_name}** (${p.product_id}): ${fmt(p.views)} view, ${fmt(p.clicks)} click, **0 mua**`
      );
      let text =
        `**Sản phẩm nhiều view nhưng ít/không mua ${period}:**\n\n` +
        (lines.length ? lines.join("\n") : "_Không phát hiện anomaly (cần ≥5 view và 0 mua)._");
      if (ragHits.length) {
        text += `\n\n**Insight từ pipeline (Qdrant):**\n${ragHits.map((h) => `- ${h.text}`).join("\n")}`;
      }
      return text;
    }

    case "funnel": {
      const { steps = [], worst_drop } = data.funnel || data;
      const lines = steps.map((s) => {
        const drop =
          s.drop_off_rate != null && s.drop_off_rate > 0
            ? ` _(rớt ${pct(s.drop_off_rate)} so với bước trước)_`
            : "";
        return `- **${s.label}:** ${fmt(s.count)}${drop}`;
      });
      let text = `**Phễu chuyển đổi ${period}:**\n\n${lines.join("\n")}`;
      if (worst_drop?.from) {
        text += `\n\n**Bước rớt nhiều nhất:** từ **${worst_drop.from}** → **${worst_drop.label}** (rớt ~${pct(worst_drop.drop_off_rate || 0)}).`;
      }
      return text;
    }

    case "sessions": {
      const k = data.kpi || {};
      return `**Sessions ${period}:** ${fmt(k.unique_sessions)} session (theo KPI 1 phút, không trùng lặp giữa các cửa sổ).`;
    }

    case "revenue": {
      const k = data.kpi || {};
      return withActions(
        `**Kết luận:** Doanh thu ${period} là **${fmtMoney(k.total_revenue)}** từ **${fmt(k.purchases)}** đơn mua.\n\n` +
          `**Bằng chứng:** conversion ~${pct(k.conversion_rate)}, ${fmt(k.unique_sessions)} session.\n\n` +
          `**Độ tin cậy:** cao (KPI PostgreSQL).`,
        actions
      );
    }

    case "banner": {
      const lines = (data.banners || []).map(
        (b) =>
          `- **${b.banner_id}:** ${fmt(b.impressions)} impression, ${fmt(b.clicks)} click, CTR ${pct(b.ctr)}`
      );
      return (
        `**Hiệu suất banner ${period}:**\n\n` +
        (lines.length ? lines.join("\n") : "_Chưa có dữ liệu banner._")
      );
    }

    case "optimize": {
      const k = data.kpi || {};
      let text =
        `**Kết luận:** Conversion ${pct(k.conversion_rate)}, doanh thu ${fmtMoney(k.total_revenue)} ${period}.\n\n` +
        `**Gợi ý hành động:** xem action cards bên dưới.\n\n` +
        `**Độ tin cậy:** trung bình–cao nếu có anomaly/funnel.`;
      if (ragHits.length) {
        text += `\n\n**Insight pipeline:**\n${ragHits.map((h) => `- ${h.text}`).join("\n")}`;
      }
      return withActions(text, actions);
    }

    case "blocked_sensitive":
      return "Mình không thể truy xuất dữ liệu cá nhân/nhạy cảm. Hãy hỏi KPI tổng hợp: doanh thu, phễu, top sản phẩm, banner.";

    case "general":
    default: {
      const k = data.kpi || {};
      let text =
        `**Kết luận:** Trong ${period} — **${fmt(k.unique_sessions)}** session, **${fmt(k.purchases)}** đơn, doanh thu **${fmtMoney(k.total_revenue)}** (conversion ~${pct(k.conversion_rate)}).\n\n`;
      if (ragHits.length) {
        text += `**Insight pipeline:**\n${ragHits.map((h) => `- ${h.text}`).join("\n")}\n\n`;
      }
      text +=
        "**Gợi ý:** Hỏi thêm phễu rớt ở đâu, SP xem nhiều không mua, hoặc nên tối ưu gì trước.\n\n**Độ tin cậy:** trung bình (snapshot KPI).";
      return text;
    }
  }
}
