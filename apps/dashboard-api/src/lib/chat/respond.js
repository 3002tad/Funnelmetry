import { formatActionsMarkdown } from "./action.engine.js";
import { formatCalendarDayLabel, formatPeriodLabel } from "../period.js";

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

function formatViewPurchaseGapExplanation(products, period) {
  const rows = (products || [])
    .map((p) => ({
      ...p,
      views: Number(p.views) || 0,
      purchases: Number(p.purchases) || 0,
    }))
    .filter((p) => p.views >= 3)
    .map((p) => ({
      ...p,
      rate: p.views > 0 ? p.purchases / p.views : 0,
    }))
    .sort((a, b) => a.rate - b.rate || b.views - a.views);

  if (!rows.length) {
    return `_Chưa đủ dữ liệu sản phẩm trong ${period} để so sánh view/mua._`;
  }

  const zeroBuy = rows.filter((p) => p.purchases === 0 && p.views >= 5);
  const lowCr = rows.filter((p) => p.purchases > 0 && p.rate > 0 && p.rate < 0.2 && p.views >= 5);

  const lines = [];
  if (zeroBuy.length) {
    lines.push(
      `**Nhiều view nhưng 0 mua** (quan tâm nhưng chưa chốt đơn):\n` +
        zeroBuy
          .slice(0, 5)
          .map(
            (p) =>
              `- **${p.product_name}** (\`${p.product_id}\`): ${fmt(p.views)} view, 0 mua — có thể do giá, mô tả, CTA hoặc nghẽn checkout.`
          )
          .join("\n")
    );
  }
  if (lowCr.length) {
    lines.push(
      `**View cao, mua thấp** (conversion SP < 20%):\n` +
        lowCr
          .slice(0, 5)
          .map(
            (p) =>
              `- **${p.product_name}** (\`${p.product_id}\`): ${fmt(p.views)} view, ${fmt(p.purchases)} mua (~${pct(p.rate)})`
          )
          .join("\n")
    );
  }

  const topView = [...rows].sort((a, b) => b.views - a.views)[0];
  if (topView && topView.views >= 5 && topView.rate >= 0.25 && !zeroBuy.length && !lowCr.length) {
    return (
      `**Giải thích ${period}:**\n\n` +
      `**${topView.product_name}** (\`${topView.product_id}\`) có **${fmt(topView.views)}** view và **${fmt(topView.purchases)}** mua (~**${pct(topView.rate)}** mua/view) — đây là SP **được quan tâm và có chuyển đổi**, không thuộc nhóm “xem nhiều nhưng không mua”.\n\n` +
      `_Nếu bạn muốn SP “nhiều view, 0 mua”, hỏi lại: *sản phẩm nào nhiều view nhưng không mua* — mình sẽ liệt kê theo ngưỡng ≥5 view và 0 đơn._`
    );
  }
  if (topView && !zeroBuy.find((p) => p.product_id === topView.product_id)) {
    lines.push(
      `_SP được xem nhiều nhất ${period}: **${topView.product_name}** — ${fmt(topView.views)} view, ${fmt(topView.purchases)} mua (~${pct(topView.rate)} mua/view)._`
    );
  }

  if (!lines.length) {
    return (
      `Trong ${period}, các SP có traffic đều có tín hiệu mua — không thấy pattern “xem nhiều, mua ít” rõ ở ngưỡng ≥5 view. ` +
      `_Có thể hỏi lại với cửa sổ dài hơn hoặc xem phễu checkout._`
    );
  }

  return lines.join("\n\n");
}

function periodLabel(minutes, calendarDate = null) {
  if (calendarDate) return formatCalendarDayLabel(calendarDate);
  return formatPeriodLabel(minutes);
}

function formatPurchaseLineItem(item) {
  const id = item.product_id || item.productId || item.sku || "—";
  const name = item.name || item.product_name || id;
  const qty = Number(item.quantity ?? item.qty ?? 1);
  const unit = Number(item.price ?? item.unit_price ?? 0);
  const lineTotal = unit * qty;
  return `  - **${name}** (\`${id}\`) × ${fmt(qty)} — ${fmtMoney(lineTotal || unit)}`;
}

function formatRecentPurchasesBlock(orders, period, focusOrderId = null, opts = {}) {
  const { highlightHighest = false, kpi = null, topProducts = [], eventsMissing = false } = opts;

  if (!orders?.length) {
    let text = `_Không có event mua hàng chi tiết trong ${period}._`;
    const kpiPurchases = Number(kpi?.purchases || 0);
    if (kpiPurchases > 0) {
      text += `\n\nKPI tổng hợp vẫn ghi **${fmt(kpiPurchases)} đơn**, doanh thu **${fmtMoney(kpi.total_revenue)}** — số đó từ \`tracking_kpi_1m\`, không phải từng đơn lưu riêng.`;
      if (eventsMissing) {
        text += `\n\n_Cần commerce ingest (\`purchase_succeeded\` + \`metadata.items\`) trên Lap2 để hỏi chi tiết đơn._`;
      }
    }
    if (topProducts?.length) {
      text += `\n\n**Top sản phẩm theo doanh thu ${period}:**\n\n`;
      text += topProducts
        .map(
          (p, i) =>
            `${i + 1}. **${p.product_name}** (\`${p.product_id}\`) — ${fmtMoney(p.revenue)}`
        )
        .join("\n");
      text += `\n\n_(Doanh thu theo sản phẩm — không thay cho một đơn cụ thể.)_`;
    }
    return text;
  }

  const formatOne = (o, i) => {
    const oid = o.order_id || `event-${String(o.event_id || i + 1).slice(0, 8)}`;
    const time = o.event_time ? new Date(o.event_time).toLocaleString("vi-VN") : "—";
    const lines = (o.items || []).map(formatPurchaseLineItem);
    const itemsText = lines.length ? lines.join("\n") : "  - _(không có `items[]` trong metadata)_";
    return `**${oid}** · ${time} · ${fmtMoney(o.amount)}\n${itemsText}`;
  };

  if (highlightHighest && orders[0]) {
    return (
      `**Đơn có giá trị cao nhất ${period}:**\n\n` +
      `${formatOne(orders[0], 0)}\n\n` +
      (orders.length > 1
        ? `_Các đơn khác:_\n\n${orders.slice(1, 4).map((o, i) => formatOne(o, i + 1)).join("\n\n")}`
        : "")
    );
  }

  return (
    `**Các đơn gần nhất ${period}:**\n\n` +
    orders.map((o, i) => formatOne(o, i)).join("\n\n") +
    `\n\n_"Đơn đó" sau câu KPI tổng = đơn đầu tiên trong danh sách (gần nhất), không phải đơn lớn nhất từ tổng hợp._`
  );
}

export function formatAnswer(
  intent,
  {
    minutes,
    calendar_date = null,
    data,
    ragHits = [],
    rewritten = false,
    actions = [],
    sub_intents = [],
  }
) {
  const period = periodLabel(minutes, calendar_date);

  switch (intent) {
    case "compound": {
      const parts = (sub_intents || []).map(({ intent: subIntent, clause }, i) => {
        const body = formatAnswer(subIntent, {
          minutes,
          calendar_date,
          data,
          ragHits,
          rewritten,
          actions: [],
        });
        const label = clause ? `**${i + 1}. ${clause}**` : `**Phần ${i + 1}**`;
        return `${label}\n\n${body}`;
      });
      return withActions(parts.join("\n\n---\n\n"), actions);
    }

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
      const thin = Number(k.total_events) === 0;
      const body = thin
        ? `Chưa thấy traffic đáng kể trong ${period} — cần bật web-shop và gửi event (SDK) trước khi phân tích sâu.`
        : `Trong ${period}, shop có **${fmt(k.unique_sessions)}** phiên, **${fmt(k.purchases)}** đơn và doanh thu **${fmtMoney(k.total_revenue)}** (conversion ~${pct(k.conversion_rate)}). ` +
          `Traffic: ${fmt(k.page_views)} lượt xem trang, ${fmt(k.product_views)} xem SP; ${fmt(k.add_to_cart)} thêm giỏ, ${fmt(k.checkout_start)} checkout. ` +
          `Tổng ${fmt(k.total_events)} event trong cửa sổ này.`;
      return withActions(body, actions);
    }

    case "checkout": {
      const { steps = [] } = data.funnel || data;
      const checkout = steps.find((s) => s.step === "checkout_start");
      const purchase = steps.find((s) => s.step === "purchase");
      const cart = steps.find((s) => s.step === "add_to_cart");
      let text =
        `**Checkout ${period}:**\n\n` +
        `- **Thêm giỏ:** ${fmt(cart?.count)}\n` +
        `- **Checkout:** ${fmt(checkout?.count)}\n` +
        `- **Mua:** ${fmt(purchase?.count)}\n`;
      if (checkout?.drop_off_rate > 0) {
        text += `- Rớt checkout → mua: **${pct(checkout.drop_off_rate)}**\n`;
      }
      return text;
    }

    case "orders": {
      const k = data.kpi || {};
      return (
        `**Số đơn mua ${period}:** **${fmt(k.purchases)}** đơn\n\n` +
        `- Doanh thu: ${fmtMoney(k.total_revenue)}\n` +
        `- Sessions: ${fmt(k.unique_sessions)}`
      );
    }

    case "aov": {
      const k = data.kpi || {};
      const purchases = Number(k.purchases) || 0;
      const aov = purchases > 0 ? Number(k.total_revenue) / purchases : 0;
      return (
        `**Giá trị đơn trung bình (AOV) ${period}:** **${fmtMoney(aov)}**\n\n` +
        `- ${fmt(purchases)} đơn · tổng doanh thu ${fmtMoney(k.total_revenue)}`
      );
    }

    case "pageviews": {
      const k = data.kpi || {};
      return (
        `**Lượt xem ${period}:**\n\n` +
        `- **Page views:** ${fmt(k.page_views)}\n` +
        `- **Product views:** ${fmt(k.product_views)}\n` +
        `- **Sessions:** ${fmt(k.unique_sessions)}`
      );
    }

    case "events": {
      const k = data.kpi || {};
      return `**Tổng events tracking ${period}:** **${fmt(k.total_events)}** (KPI aggregate 1 phút).`;
    }

    case "catalog": {
      const cat = data.catalog || {};
      return `**Catalog PostgreSQL:** **${fmt(cat.product_count)}** sản phẩm (từ \`products_catalog\`, cập nhật qua event pipeline).`;
    }

    case "search": {
      const lines = (data.searches || []).map(
        (s, i) => `${i + 1}. **${s.search_query}** — ${fmt(s.searches)} lượt tìm`
      );
      return (
        `**Top từ khóa tìm kiếm ${period}:**\n\n` +
        (lines.length ? lines.join("\n") : "_Chưa có event \`search\` trong cửa sổ này._")
      );
    }

    case "filters": {
      const lines = (data.filters || []).map(
        (f) =>
          `- **${f.category || "all"}**${f.sort_mode ? ` / sort: ${f.sort_mode}` : ""} — ${fmt(f.filter_events)} lần lọc`
      );
      return (
        `**Bộ lọc / filter ${period}:**\n\n` +
        (lines.length ? lines.join("\n") : "_Chưa có event \`filter_apply\`._")
      );
    }

    case "category": {
      const lines = (data.categories || []).map(
        (c, i) =>
          `${i + 1}. **${c.category}** — ${fmtMoney(c.revenue)} doanh thu, ${fmt(c.purchases)} mua, ${fmt(c.views)} view`
      );
      return (
        `**Hiệu suất theo danh mục ${period}:**\n\n` +
        (lines.length ? lines.join("\n") : "_Chưa có KPI theo category._")
      );
    }

    case "banner_detail": {
      const bd = data.banner_detail;
      if (!bd?.found) {
        return `_Không tìm thấy banner khớp **"${bd?.query || "?"}"** trong KPI ${period}._`;
      }
      const b = bd.banner;
      return (
        `**Banner \`${b.banner_id}\` ${period}:**\n\n` +
        `- Impression: ${fmt(b.impressions)} · Click: ${fmt(b.clicks)} · CTR: ${pct(b.ctr)}`
      );
    }

    case "insights": {
      const k = data.kpi || {};
      const lines = ragHits.map((h) => `- ${h.text}${h.insight_type ? ` _(${h.insight_type})_` : ""}`);
      let text = `**Insight pipeline (Qdrant) ${period}:**\n\n`;
      text += lines.length ? lines.join("\n") : "_Chưa có insight khớp trong cửa sổ này._";
      if (Number(k.total_events) > 0) {
        text += `\n\n**Bối cảnh KPI:** ${fmt(k.purchases)} đơn, doanh thu ${fmtMoney(k.total_revenue)}, conversion ${pct(k.conversion_rate)}.`;
      }
      return text;
    }

    case "cart_abandon": {
      const { steps = [], worst_drop } = data.funnel || data;
      const cart = steps.find((s) => s.step === "add_to_cart");
      const checkout = steps.find((s) => s.step === "checkout_start");
      const purchase = steps.find((s) => s.step === "purchase");
      let text =
        `**Giỏ hàng / bỏ giỏ ${period}:**\n\n` +
        `- **Thêm giỏ:** ${fmt(cart?.count)}\n` +
        `- **Checkout:** ${fmt(checkout?.count)}\n` +
        `- **Mua:** ${fmt(purchase?.count)}\n`;
      if (cart?.count > 0 && checkout?.drop_off_rate != null) {
        text += `- Rớt từ thêm giỏ → checkout: **${pct(checkout.drop_off_rate)}**\n`;
      }
      if (worst_drop?.from) {
        text += `\n**Bước rớt mạnh nhất:** ${worst_drop.from} → ${worst_drop.label}.`;
      }
      if (ragHits.length) {
        text += `\n\n**Insight:**\n${ragHits.map((h) => `- ${h.text}`).join("\n")}`;
      }
      return text;
    }

    case "conversion": {
      const k = data.kpi || {};
      const { steps = [] } = data.funnel || data;
      const lines = steps.map((s) => `- **${s.label}:** ${fmt(s.count)}`).join("\n");
      return (
        `**Conversion shop ${period}:**\n\n` +
        `- **Mua / session:** ${pct(k.conversion_rate)} (${fmt(k.purchases)} đơn / ${fmt(k.unique_sessions)} session)\n` +
        `- **Doanh thu:** ${fmtMoney(k.total_revenue)}\n\n` +
        `**Phễu:**\n${lines || "_Chưa có dữ liệu phễu._"}`
      );
    }

    case "product_detail": {
      const pd = data.product_detail;
      if (!pd?.found) {
        return withActions(
          `_Không tìm thấy sản phẩm khớp **"${pd?.query || "?"}"** trong catalog PostgreSQL._\n\n` +
            `Gợi ý: kiểm tra tên trên dashboard Products hoặc hỏi bằng mã \`P001\`. Catalog được sync từ event web-shop.`,
          actions
        );
      }
      const p = pd.product || {};
      const s = pd.stats || {};
      let text =
        `**${p.name || s.product_name}** (\`${p.product_id}\`) — ${period}:\n\n` +
        `- **Giá catalog:** ${fmtMoney(p.price)} · **Danh mục:** ${p.category || "—"}\n` +
        `- **View:** ${fmt(s.views)} · **Click:** ${fmt(s.clicks)} · **Mua:** ${fmt(s.purchases)}\n` +
        `- **Doanh thu:** ${fmtMoney(s.revenue)} · **Conversion (view→mua):** ${pct(s.conversion_rate)}\n\n` +
        `**Độ tin cậy:** cao (KPI PostgreSQL + catalog).`;
      if (Number(s.views) >= 5 && Number(s.purchases) === 0) {
        text += `\n\n**Lưu ý:** SP có view nhưng chưa có đơn — có thể thuộc nhóm high-view/low-purchase.`;
      }
      if (ragHits.length) {
        text += `\n\n**Insight pipeline:**\n${ragHits.map((h) => `- ${h.text}`).join("\n")}`;
      }
      return withActions(text, actions);
    }

    case "top_products": {
      const sort = data.product_sort || "views";
      const title =
        sort === "purchases"
          ? `**Top sản phẩm theo lượt mua ${period}:**`
          : sort === "revenue"
            ? `**Top sản phẩm theo doanh thu ${period}:**`
            : `**Top sản phẩm theo lượt xem ${period}:**`;
      const lines = (data.products || []).map(
        (p, i) =>
          `${i + 1}. **${p.product_name}** (${p.product_id}) — ${fmt(p.purchases)} mua, ${fmt(p.views)} view, ${fmtMoney(p.revenue)}`
      );
      return (
        `${title}\n\n` +
        (lines.length ? lines.join("\n") : "_Chưa có dữ liệu sản phẩm trong khoảng thời gian này._")
      );
    }

    case "product_anomaly": {
      const strict = (data.anomalies || []).map(
        (p) =>
          `- **${p.product_name}** (\`${p.product_id}\`): ${fmt(p.views)} view, ${fmt(p.clicks)} click, **0 mua**`
      );
      let text = `**Sản phẩm nhiều view nhưng ít/không mua ${period}:**\n\n`;
      if (strict.length) {
        text += strict.join("\n");
      } else {
        text += formatViewPurchaseGapExplanation(data.products, period);
      }
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

    case "recent_purchases": {
      return withActions(
        formatRecentPurchasesBlock(data.recent_purchases, period, data.focus_order_id, {
          highlightHighest: data.order_sort === "amount_desc",
          kpi: data.kpi,
          topProducts: data.products,
          eventsMissing: data.purchase_events_missing,
        }),
        actions
      );
    }

    case "revenue": {
      const k = data.kpi || {};
      return withActions(
        `Trong **${period}**, shop đạt doanh thu **${fmtMoney(k.total_revenue)}** với **${fmt(k.purchases)}** đơn trên **${fmt(k.unique_sessions)}** phiên (conversion ~${pct(k.conversion_rate)}).`,
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
        `Snapshot ${period}: **${fmt(k.unique_sessions)}** phiên, **${fmt(k.purchases)}** đơn, doanh thu **${fmtMoney(k.total_revenue)}** (conversion ~${pct(k.conversion_rate)}).`;
      if (ragHits.length) {
        text += `\n\nInsight pipeline gần đây:\n${ragHits.map((h) => `- ${h.text}`).join("\n")}`;
      }
      text += "\n\nBạn có thể hỏi sâu hơn: phễu rớt ở đâu, SP xem nhiều không mua, hoặc nên tối ưu gì trước.";
      return text;
    }
  }
}
