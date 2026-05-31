/**
 * Compose grounded analytics brief for assistant-style replies (before Ollama polish).
 */

function fmt(n) {
  return Number(n || 0).toLocaleString("vi-VN");
}
function money(n) {
  return `${fmt(n)} ₫`;
}
function pct(r) {
  return `${(Number(r || 0) * 100).toFixed(2)}%`;
}
function pctSigned(r) {
  const n = Number(r || 0) * 100;
  return `${n >= 0 ? "+" : ""}${n.toFixed(1)}%`;
}

function hasTraffic(k) {
  return Number(k.total_events) > 0 || Number(k.unique_sessions) > 0;
}

function buildFindings(data, minutes) {
  const findings = [];
  const k = data.kpi || {};
  const worst = data.funnel?.worst_drop || data.worst_drop;
  const period = `${minutes} phút gần nhất`;

  if (!hasTraffic(k)) {
    findings.push({
      severity: "high",
      text: `Chưa có traffic đáng kể trong ${period} — cần gửi event từ web-shop (SDK) trước khi kết luận sâu.`,
    });
    return findings;
  }

  if (Number(k.purchases) === 0 && Number(k.add_to_cart) > 0) {
    findings.push({
      severity: "high",
      text: `Có ${fmt(k.add_to_cart)} lượt thêm giỏ nhưng 0 đơn — nghẽn có thể ở checkout/giá/thanh toán.`,
    });
  } else if (Number(k.purchases) === 0 && Number(k.product_views) > 10) {
    findings.push({
      severity: "medium",
      text: `${fmt(k.product_views)} lượt xem sản phẩm nhưng chưa có đơn — cần xem SP high-view/low-purchase và CTA.`,
    });
  }

  if (worst?.label && (worst.drop_off_rate || 0) >= 0.25) {
    findings.push({
      severity: worst.drop_off_rate >= 0.5 ? "high" : "medium",
      text: `Phễu rớt mạnh tại bước **${worst.label}** (~${pct(worst.drop_off_rate)} so với bước trước).`,
    });
  }

  for (const p of (data.anomalies || []).slice(0, 3)) {
    findings.push({
      severity: Number(p.severity_score) >= 15 ? "high" : "medium",
      text: `**${p.product_name || p.product_id}**: ${fmt(p.views)} view, 0 mua — high-view/low-purchase.`,
    });
  }

  const cmp = data.comparison?.delta;
  if (cmp?.purchases_pct != null && cmp.purchases_pct <= -0.1) {
    findings.push({
      severity: "high",
      text: `Đơn mua giảm **${pctSigned(cmp.purchases_pct)}** so với kỳ trước (cùng ${minutes} phút).`,
    });
  } else if (cmp?.revenue_pct != null && cmp.revenue_pct >= 0.1) {
    findings.push({
      severity: "low",
      text: `Doanh thu tăng **${pctSigned(cmp.revenue_pct)}** so với kỳ trước — đà tích cực.`,
    });
  }

  const weakBanner = (data.banners || []).find(
    (b) => Number(b.impressions) >= 10 && Number(b.ctr) < 0.02
  );
  if (weakBanner) {
    findings.push({
      severity: "medium",
      text: `Banner **${weakBanner.banner_id}** CTR thấp (${pct(weakBanner.ctr)}) dù có impression.`,
    });
  }

  return findings.slice(0, 5);
}

function intentFocus(intent, data, minutes) {
  const k = data.kpi || {};
  switch (intent) {
    case "revenue":
      return `Câu hỏi về doanh thu: ${money(k.total_revenue)} từ ${fmt(k.purchases)} đơn, conversion ${pct(k.conversion_rate)}.`;
    case "funnel":
      return "Câu hỏi về phễu chuyển đổi — xem bước rớt và số lượng từng bước bên dưới.";
    case "product_anomaly":
      return "Câu hỏi về sản phẩm xem nhiều nhưng không mua.";
    case "comparison":
      return "Câu hỏi so sánh kỳ hiện tại với kỳ trước (cùng độ dài cửa sổ).";
    case "top_products":
      return "Câu hỏi về top sản phẩm theo lượt xem / mua.";
    case "product_detail":
      return "Câu hỏi chi tiết một sản phẩm cụ thể — view, mua, doanh thu, conversion.";
    case "insights":
      return "Câu hỏi về insight/cảnh báo từ pipeline (Qdrant).";
    case "cart_abandon":
      return "Câu hỏi về bỏ giỏ / rớt sau thêm giỏ.";
    case "conversion":
      return "Câu hỏi về tỷ lệ chuyển đổi tổng shop.";
    case "search":
      return "Câu hỏi về từ khóa tìm kiếm trên shop.";
    case "filters":
      return "Câu hỏi về bộ lọc / filter_apply events.";
    case "category":
      return "Câu hỏi hiệu suất theo danh mục sản phẩm.";
    case "orders":
      return "Câu hỏi về số đơn mua.";
    case "aov":
      return "Câu hỏi giá trị đơn trung bình (AOV).";
    case "pageviews":
      return "Câu hỏi lượt xem trang / product view.";
    case "events":
      return "Câu hỏi tổng volume event tracking.";
    case "catalog":
      return "Câu hỏi về catalog sản phẩm trong Postgres.";
    case "checkout":
      return "Câu hỏi bước checkout / thanh toán.";
    case "banner_detail":
      return "Câu hỏi chi tiết một banner cụ thể.";
    case "banner":
      return "Câu hỏi về hiệu quả banner.";
    case "optimize":
      return "Câu hỏi tối ưu / nên làm gì trước — ưu tiên theo impact conversion & doanh thu.";
    default:
      return `Câu hỏi tổng quan về sức khỏe shop trong ${minutes} phút gần nhất.`;
  }
}

/**
 * @returns {string} Markdown brief for polish step
 */
export function composeAnalystReport({
  intent,
  minutes,
  userMessage,
  data,
  ragHits = [],
  actions = [],
  sub_intents = [],
}) {
  const k = data.kpi || {};
  const period = `${minutes} phút gần nhất`;
  const findings = buildFindings(data, minutes);
  const lines = [];

  lines.push(`## BỐI CẢNH PHÂN TÍCH`);
  lines.push(`- Cửa sổ: ${period}`);
  if (intent === "compound" && sub_intents?.length) {
    lines.push(
      `- Câu hỏi kép (${sub_intents.length} phần): ${sub_intents.map((s) => `"${s.clause}" → ${s.intent}`).join("; ")}`
    );
  } else {
    lines.push(`- ${intentFocus(intent, data, minutes)}`);
  }
  lines.push(`- Câu hỏi người dùng: "${(userMessage || "").trim()}"`);

  lines.push(`\n## CHỈ SỐ CHÍNH (PostgreSQL)`);
  if (data.kpi) {
    lines.push(`- Sessions: ${fmt(k.unique_sessions)} | Events: ${fmt(k.total_events)}`);
    lines.push(
      `- PV: ${fmt(k.page_views)} | Product views: ${fmt(k.product_views)} | Thêm giỏ: ${fmt(k.add_to_cart)} | Checkout: ${fmt(k.checkout_start)} | Mua: ${fmt(k.purchases)}`
    );
    lines.push(`- Doanh thu: ${money(k.total_revenue)} | Conversion (mua/session): ${pct(k.conversion_rate)}`);
  } else {
    lines.push(`- (Chưa có KPI tổng hợp)`);
  }

  if (data.comparison?.current) {
    const d = data.comparison.delta || {};
    lines.push(`\n## SO SÁNH KỲ TRƯỚC`);
    lines.push(`- Sessions: ${pctSigned(d.sessions_pct)} | Đơn: ${pctSigned(d.purchases_pct)} | Doanh thu: ${pctSigned(d.revenue_pct)}`);
  }

  const steps = data.funnel?.steps || data.steps;
  if (steps?.length) {
    lines.push(`\n## PHỄU`);
    for (const s of steps) {
      const drop =
        s.drop_off_rate > 0 ? ` (rớt ${pct(s.drop_off_rate)})` : "";
      lines.push(`- ${s.label}: ${fmt(s.count)}${drop}`);
    }
  }

  if (data.anomalies?.length) {
    lines.push(`\n## SẢN PHẨM BẤT THƯỜNG`);
    for (const p of data.anomalies.slice(0, 5)) {
      lines.push(`- ${p.product_name} (${p.product_id}): ${fmt(p.views)} view, 0 mua`);
    }
  }

  if (data.product_detail) {
    const pd = data.product_detail;
    lines.push(`\n## CHI TIẾT SẢN PHẨM`);
    if (!pd.found) {
      lines.push(`- Không tìm thấy sản phẩm khớp "${pd.query}" trong catalog.`);
    } else {
      const p = pd.product || {};
      const s = pd.stats || {};
      lines.push(`- ${p.name || s.product_name} (${p.product_id})`);
      lines.push(`- Giá catalog: ${money(p.price)} | Danh mục: ${p.category || "—"}`);
      lines.push(
        `- View: ${fmt(s.views)} | Click: ${fmt(s.clicks)} | Mua: ${fmt(s.purchases)} | Doanh thu: ${money(s.revenue)} | CR: ${pct(s.conversion_rate)}`
      );
    }
  }

  if (data.products?.length) {
    const sort = data.product_sort || "views";
    const heading =
      sort === "purchases"
        ? "TOP SẢN PHẨM (mua)"
        : sort === "revenue"
          ? "TOP SẢN PHẨM (doanh thu)"
          : "TOP SẢN PHẨM (view)";
    lines.push(`\n## ${heading}`);
    data.products.slice(0, 5).forEach((p, i) => {
      lines.push(`${i + 1}. ${p.product_name}: ${fmt(p.purchases)} mua, ${fmt(p.views)} view, ${money(p.revenue)}`);
    });
  }

  if (data.banners?.length) {
    lines.push(`\n## BANNER`);
    for (const b of data.banners.slice(0, 5)) {
      lines.push(`- ${b.banner_id}: CTR ${pct(b.ctr)}, ${fmt(b.impressions)} imp`);
    }
  }

  if (ragHits.length) {
    lines.push(`\n## INSIGHT PIPELINE (Qdrant)`);
    ragHits.forEach((h) => lines.push(`- ${h.text}`));
  }

  lines.push(`\n## PHÁT HIỆN (suy ra từ số liệu trên)`);
  if (findings.length) {
    findings.forEach((f, i) => lines.push(`${i + 1}. [${f.severity}] ${f.text}`));
  } else {
    lines.push(`- Không có tín hiệu bất thường rõ trong cửa sổ này (hoặc dữ liệu còn mỏng).`);
  }

  lines.push(`\n## ƯU TIÊN HÀNH ĐỘNG (đề xuất)`);
  if (actions.length) {
    actions.forEach((a, i) => {
      lines.push(
        `${i + 1}. [${a.priority}] ${a.title} — ${a.suggestion} (tin cậy ~${(a.confidence * 100).toFixed(0)}%)`
      );
    });
  } else if (hasTraffic(k)) {
    lines.push(`- Tiếp tục theo dõi; chưa đủ tín hiệu để đề xuất việc cụ thể.`);
  } else {
    lines.push(`- Bật web-shop + tracking SDK; tạo vài session test rồi hỏi lại.`);
  }

  for (const line of buildDeliveryHints(intent, data, minutes)) {
    lines.push(line);
  }

  return lines.join("\n");
}

/** Hints for polish step — not shown to end user. */
function buildDeliveryHints(intent, data) {
  const lines = [`\n## HƯỚNG VIẾT (cho bước diễn đạt)`];
  const k = data.kpi || {};
  const worst = data.funnel?.worst_drop || data.worst_drop;

  switch (intent) {
    case "funnel":
      lines.push("- Mở đầu: bước phễu đang rớt mạnh nhất và mức rớt (%).");
      lines.push("- Liệt kê ngắn 2–3 bước then chốt nếu cần hành động.");
      break;
    case "revenue":
    case "orders":
    case "aov":
      lines.push("- Mở đầu: con số doanh thu/đơn/AOV trả lời trực tiếp câu hỏi.");
      lines.push("- Thêm 1 câu bối cảnh (session hoặc conversion) nếu có trong báo cáo.");
      break;
    case "product_detail":
      lines.push("- Nêu tên SP + view/mua/doanh thu; nếu không tìm thấy thì nói rõ và gợi ý gõ ID.");
      break;
    case "product_anomaly":
    case "top_products":
      lines.push("- Gọi tên 2–3 SP cụ thể từ báo cáo; tránh chỉ nói chung chung.");
      break;
    case "comparison":
    case "trend":
      lines.push("- Nêu hướng tăng/giảm so với kỳ trước bằng % có trong báo cáo.");
      break;
    case "cart_abandon":
    case "checkout":
      lines.push("- So sánh thêm giỏ vs checkout vs mua; chỉ ra nghẽn có thể.");
      break;
    case "banner":
    case "banner_detail":
      lines.push("- CTR/impression của banner được hỏi; so sánh ngắn nếu có nhiều banner.");
      break;
    case "optimize":
    case "general":
      lines.push("- Tổng hợp 1 câu sức khỏe shop, rồi 1–2 vấn đề từ PHÁT HIỆN, rồi ưu tiên hành động.");
      break;
    case "compound":
      lines.push("- Trả lời **từng phần** câu hỏi kép theo thứ tự; mỗi phần có số liệu riêng, không gộp lẫn.");
      lines.push("- Dùng tiêu đề ngắn hoặc chuyển ý rõ giữa các phần.");
      break;
    default:
      if (Number(k.purchases) === 0 && Number(k.add_to_cart) > 0) {
        lines.push("- Nhấn mạnh: có giỏ nhưng chưa có đơn — gợi ý checkout/payment.");
      }
      if (worst?.label) {
        lines.push(`- Nhắc phễu rớt tại bước ${worst.label} nếu liên quan câu hỏi.`);
      }
      lines.push("- Trả lời đúng intent; đoạn văn tự nhiên, không slide.");
  }

  lines.push('- Không thêm số mới; giả thuyết phải có "có thể".');
  return lines;
}
