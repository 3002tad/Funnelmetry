/**
 * Aggregate product KPIs for BI hero + action panels.
 */
export function buildProductSummary(products, anomalies = []) {
  if (!products?.length) {
    return {
      totalViews: 0,
      totalRevenue: 0,
      totalPurchases: 0,
      totalCart: 0,
      avgConvPct: 0,
      cartRatePct: 0,
      skuCount: 0,
      anomalyCount: anomalies.length,
      topByViews: null,
      topByRevenue: null,
      lowConv: null,
      revenueLeaderShare: 0,
    };
  }

  const totalViews = products.reduce((s, p) => s + Number(p.views || 0), 0);
  const totalRevenue = products.reduce((s, p) => s + Number(p.revenue || 0), 0);
  const totalPurchases = products.reduce((s, p) => s + Number(p.purchases || 0), 0);
  const totalCart = products.reduce((s, p) => s + Number(p.add_to_cart || 0), 0);
  const avgConvPct = totalViews > 0 ? (totalPurchases / totalViews) * 100 : 0;
  const cartRatePct = totalViews > 0 ? (totalCart / totalViews) * 100 : 0;

  const topByViews = products[0];
  const topByRevenue = [...products].sort(
    (a, b) => Number(b.revenue) - Number(a.revenue)
  )[0];

  const withTraffic = products.filter((p) => Number(p.views) >= 5);
  const lowConv = withTraffic.length
    ? [...withTraffic].sort(
        (a, b) => Number(a.purchase_rate) - Number(b.purchase_rate)
      )[0]
    : null;

  const revenueLeaderShare =
    totalRevenue > 0 && topByRevenue
      ? (Number(topByRevenue.revenue) / totalRevenue) * 100
      : 0;

  return {
    totalViews,
    totalRevenue,
    totalPurchases,
    totalCart,
    avgConvPct,
    cartRatePct,
    skuCount: products.length,
    anomalyCount: anomalies.length,
    topByViews,
    topByRevenue,
    lowConv,
    revenueLeaderShare,
  };
}

export function buildProductActionItems(summary, anomalies) {
  if (!summary || summary.skuCount === 0) return [];

  const items = [];

  items.push({
    key: "anomalies",
    level: summary.anomalyCount >= 3 ? "high" : summary.anomalyCount >= 1 ? "medium" : "good",
    title: "SKU cần tối ưu",
    value: String(summary.anomalyCount),
    hint: summary.anomalyCount > 0
      ? `${summary.anomalyCount} SP xem nhiều nhưng 0 đơn — kiểm tra giá, ảnh, mô tả.`
      : "Không có anomaly high-view / zero-purchase.",
  });

  if (summary.lowConv) {
    const rate = Number(summary.lowConv.purchase_rate || 0) * 100;
    items.push({
      key: "low-conv",
      level: rate < 0.5 ? "high" : rate < 2 ? "medium" : "good",
      title: "Conversion thấp nhất",
      value: `${rate.toFixed(2)}%`,
      hint: `"${summary.lowConv.product_name || summary.lowConv.product_id}" — ${Number(summary.lowConv.views).toLocaleString("vi-VN")} lượt xem.`,
    });
  }

  items.push({
    key: "revenue-share",
    level: summary.revenueLeaderShare >= 70 ? "medium" : "good",
    title: "SKU dẫn doanh thu",
    value: summary.topByRevenue
      ? `${summary.revenueLeaderShare.toFixed(0)}%`
      : "—",
    hint: summary.topByRevenue
      ? `${summary.topByRevenue.product_name || summary.topByRevenue.product_id} chiếm phần lớn doanh thu trong top list.`
      : "Chưa đủ dữ liệu phân bổ.",
  });

  return items;
}
