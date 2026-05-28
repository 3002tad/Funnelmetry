export function buildSearchSummary(searches, filters) {
  const totalSearches = (searches || []).reduce((s, r) => s + Number(r.searches || 0), 0);
  const totalFilters = (filters || []).reduce((s, r) => s + Number(r.filter_events || 0), 0);
  const topQuery = searches?.[0];
  const topFilter = filters?.[0];
  const uniqueQueries = searches?.length || 0;
  const topShare = totalSearches > 0 && topQuery
    ? (Number(topQuery.searches) / totalSearches) * 100
    : 0;

  return {
    totalSearches,
    totalFilters,
    uniqueQueries,
    topQuery,
    topFilter,
    topShare,
  };
}

export function buildSearchActionItems(summary) {
  if (!summary || summary.totalSearches === 0) {
    return [{
      key: "no-data",
      level: "medium",
      title: "Chưa có search",
      value: "—",
      hint: "Khách chưa tìm kiếm trong kỳ — kiểm tra SDK event search.",
    }];
  }

  return [
    {
      key: "top-query",
      level: summary.topShare >= 40 ? "medium" : "good",
      title: "Từ khóa dẫn dắt",
      value: summary.topShare >= 40 ? `${summary.topShare.toFixed(0)}%` : "Đa dạng",
      hint: summary.topQuery
        ? `"${summary.topQuery.query}" — ${Number(summary.topQuery.searches).toLocaleString("vi-VN")} lượt.`
        : "—",
    },
    {
      key: "filter-usage",
      level: summary.totalFilters < summary.totalSearches * 0.1 ? "medium" : "good",
      title: "Dùng bộ lọc",
      value: summary.totalFilters.toLocaleString("vi-VN"),
      hint: summary.totalFilters < summary.totalSearches * 0.1
        ? "Ít dùng filter — cân nhắc UX lọc sản phẩm rõ hơn."
        : "Filter đang được dùng tích cực.",
    },
    {
      key: "query-count",
      level: summary.uniqueQueries < 3 ? "medium" : "good",
      title: "Đa dạng query",
      value: String(summary.uniqueQueries),
      hint: summary.uniqueQueries < 3
        ? "Ít từ khóa khác nhau — merchandising có thể hẹp."
        : `${summary.uniqueQueries} từ khóa khác nhau trong kỳ.`,
    },
  ];
}
