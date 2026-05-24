function fmt(n) {
  return Number(n || 0).toLocaleString("vi-VN");
}

function fmtMoney(n) {
  return `${fmt(n)} ₫`;
}

function pct(rate) {
  return `${(Number(rate) * 100).toFixed(2)}%`;
}

export function formatAnswer(intent, { minutes, data, ragHits = [] }) {
  const period = `trong ${minutes} phút gần nhất`;

  switch (intent) {
    case "overview": {
      const k = data.kpi;
      return (
        `**Tóm tắt ${period}** (số liệu từ PostgreSQL):\n\n` +
        `- **Sessions:** ${fmt(k.unique_sessions)}\n` +
        `- **Page views:** ${fmt(k.page_views)} · **Product views:** ${fmt(k.product_views)}\n` +
        `- **Thêm giỏ:** ${fmt(k.add_to_cart)} · **Checkout:** ${fmt(k.checkout_start)} · **Đơn mua:** ${fmt(k.purchases)}\n` +
        `- **Doanh thu:** ${fmtMoney(k.total_revenue)}\n` +
        `- **Tỷ lệ chuyển đổi (mua/session):** ${pct(k.conversion_rate)}\n` +
        `- **Tổng events:** ${fmt(k.total_events)}`
      );
    }

    case "top_products": {
      const lines = data.products.map(
        (p, i) =>
          `${i + 1}. **${p.product_name}** (${p.product_id}) — ${fmt(p.views)} view, ${fmt(p.purchases)} mua, ${fmtMoney(p.revenue)}`
      );
      return (
        `**Top sản phẩm theo lượt xem ${period}:**\n\n` +
        (lines.length ? lines.join("\n") : "_Chưa có dữ liệu sản phẩm trong khoảng thời gian này._")
      );
    }

    case "product_anomaly": {
      const lines = data.anomalies.map(
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
      const { steps, worst_drop } = data;
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
      return `**Sessions ${period}:** ${fmt(data.kpi.unique_sessions)} session (theo KPI 1 phút, không trùng lặp giữa các cửa sổ).`;
    }

    case "revenue": {
      return `**Doanh thu ${period}:** ${fmtMoney(data.kpi.total_revenue)} từ ${fmt(data.kpi.purchases)} đơn mua.`;
    }

    case "banner": {
      const lines = data.banners.map(
        (b) =>
          `- **${b.banner_id}:** ${fmt(b.impressions)} impression, ${fmt(b.clicks)} click, CTR ${pct(b.ctr)}`
      );
      return (
        `**Hiệu suất banner ${period}:**\n\n` +
        (lines.length ? lines.join("\n") : "_Chưa có dữ liệu banner._")
      );
    }

    case "optimize": {
      const tips = [];
      if (data.anomalies?.length) {
        tips.push(
          `Ưu tiên ${data.anomalies.length} SP high-view/low-purchase: cải thiện giá, ảnh, mô tả hoặc CTA thêm giỏ.`
        );
      }
      if (data.funnel?.worst_drop?.label) {
        tips.push(`Tối ưu bước **${data.funnel.worst_drop.label}** — nơi rớt nhiều nhất trong phễu.`);
      }
      if (ragHits.length) {
        tips.push(...ragHits.slice(0, 3).map((h) => h.text));
      }
      if (!tips.length) {
        tips.push("Tiếp tục thu thập event; khi có đủ KPI sẽ có gợi ý cụ thể hơn.");
      }
      return `**Gợi ý tối ưu** (dựa trên số liệu DB + insight Qdrant):\n\n${tips.map((t) => `- ${t}`).join("\n")}`;
    }

    case "general":
    default: {
      const k = data.kpi;
      let text =
        `Mình chưa chắc ý câu hỏi — đây là snapshot ${period}:\n\n` +
        `- Sessions: ${fmt(k.unique_sessions)} · Mua: ${fmt(k.purchases)} · Doanh thu: ${fmtMoney(k.total_revenue)}`;
      if (ragHits.length) {
        text += `\n\n**Insight liên quan:**\n${ragHits.map((h) => `- ${h.text}`).join("\n")}`;
      }
      text +=
        "\n\n_Bạn có thể hỏi: tóm tắt tình hình, top sản phẩm, SP nhiều view ít mua, phễu rớt ở đâu, banner CTR, gợi ý tối ưu._";
      return text;
    }
  }
}
