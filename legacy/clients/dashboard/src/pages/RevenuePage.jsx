import { useCallback, useMemo } from "react";
import { CategoryBarChart } from "../components/charts/CategoryBarChart.jsx";
import { SERIES, formatMoneyShort } from "../components/charts/chartTheme.js";
import { formatMoney } from "../lib/format.js";
import { TrendAreaChart } from "../components/charts/TrendAreaChart.jsx";
import { DataPanel, EmptyState, PageError, PageLoading } from "../components/DataPanel.jsx";
import { PageHeader } from "../components/PageHeader.jsx";
import { IconRevenue } from "../components/icons.jsx";
import { ActionCardValue } from "../components/MoneyText.jsx";
import { StatCard, StatHero } from "../components/StatCard.jsx";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";
import { useManagerPeriod } from "../hooks/useManagerPeriod.js";
import { useOnKpiUpdate } from "../context/LiveStreamContext.jsx";

function pctChange(current, previous) {
  const prev = Number(previous || 0);
  const curr = Number(current || 0);
  if (prev <= 0) return null;
  return ((curr - prev) / prev) * 100;
}

export function RevenuePage() {
  const period = useManagerPeriod();
  const summaryFetcher = useCallback(() => api.revenueSummary(period.periodParams), [period.periodParams]);
  const catFetcher = useCallback(() => api.revenueByCategory(period.periodParams), [period.periodParams]);
  const summary = useAutoRefresh(summaryFetcher, 60000);
  const categories = useAutoRefresh(catFetcher, 60000);

  // Refresh immediately when streaming-processor flushes a new KPI window.
  useOnKpiUpdate(useCallback(() => {
    summary.refresh();
    categories.refresh();
  }, [summary.refresh, categories.refresh]));

  const trendData = useMemo(
    () => (summary.data?.trend || []).map((row) => ({
      time: new Date(row.window_start).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
      revenue: Number(row.revenue),
      purchases: Number(row.purchases),
    })),
    [summary.data]
  );

  const compareMetrics = useMemo(() => {
    if (trendData.length < 4) return [];
    const mid = Math.floor(trendData.length / 2);
    const prev = trendData.slice(0, mid);
    const curr = trendData.slice(mid);
    const sum = (rows, key) => rows.reduce((acc, row) => acc + Number(row[key] || 0), 0);
    const prevRevenue = sum(prev, "revenue");
    const currRevenue = sum(curr, "revenue");
    const prevPurchases = sum(prev, "purchases");
    const currPurchases = sum(curr, "purchases");
    const prevAov = prevPurchases > 0 ? prevRevenue / prevPurchases : 0;
    const currAov = currPurchases > 0 ? currRevenue / currPurchases : 0;
    const items = [
      { label: "Doanh thu", change: pctChange(currRevenue, prevRevenue) },
      { label: "Đơn hàng", change: pctChange(currPurchases, prevPurchases) },
      { label: "AOV", change: pctChange(currAov, prevAov) },
    ];
    return items.filter((i) => i.change != null);
  }, [trendData]);

  const peakRevenuePoint = useMemo(() => {
    if (trendData.length === 0) return null;
    return trendData.reduce((max, row) => (row.revenue > max.revenue ? row : max), trendData[0]);
  }, [trendData]);

  const sparkRevenue = useMemo(() => trendData.map((r) => r.revenue), [trendData]);
  const sparkOrders = useMemo(() => trendData.map((r) => r.purchases), [trendData]);

  const s = summary.data?.summary || {};
  const catData = useMemo(
    () => (categories.data?.categories || [])
      .map((c) => ({
        name: c.category || "Khác",
        revenue: Number(c.revenue),
      }))
      .filter((c) => c.revenue > 0)
      .sort((a, b) => b.revenue - a.revenue),
    [categories.data]
  );

  const actionItems = useMemo(() => {
    const aov = Number(s.average_order_value || 0);
    const purchases = Number(s.total_purchases || 0);
    const revChange = compareMetrics.find((m) => m.label === "Doanh thu")?.change;

    const totalCatRev = catData.reduce((acc, c) => acc + c.revenue, 0);
    const topCat = catData.length > 0
      ? [...catData].sort((a, b) => b.revenue - a.revenue)[0]
      : null;
    const topShare = totalCatRev > 0 && topCat ? (topCat.revenue / totalCatRev) * 100 : 0;

    return [
      {
        key: "revenue-trend",
        level: revChange != null && revChange < -10 ? "high" : revChange != null && revChange < 0 ? "medium" : "good",
        title: "Xu hướng doanh thu",
        value: revChange != null ? `${revChange >= 0 ? "+" : ""}${revChange.toFixed(1)}%` : "—",
        hint: revChange != null && revChange < 0
          ? "Doanh thu giảm so với nửa kỳ trước — xem lại traffic và khuyến mãi."
          : "Doanh thu đang ổn định hoặc tăng trong kỳ.",
      },
      {
        key: "aov",
        level: purchases > 0 && aov < 100000 ? "medium" : "good",
        title: "Giá trị đơn TB",
        value: formatMoney(aov),
        hint: purchases > 0 && aov < 100000
          ? "AOV thấp — cân nhắc bundle, upsell hoặc tăng giá trị giỏ hàng."
          : "Giá trị đơn hàng trung bình đang ổn.",
      },
      {
        key: "top-category",
        level: topShare >= 65 ? "medium" : "good",
        title: "Danh mục dẫn dắt",
        value: topCat ? `${topShare.toFixed(0)}%` : "—",
        hint: topCat
          ? `${topCat.name} chiếm ${topShare.toFixed(0)}% doanh thu${topShare >= 65 ? " — phụ thuộc cao." : "."}`
          : "Chưa đủ dữ liệu phân bổ danh mục.",
      },
    ];
  }, [s, catData, compareMetrics]);

  if (summary.loading && !summary.data) {
    return (
      <>
        <PageHeader
          title="Doanh thu"
          minutes={period.minutes}
          onMinutesChange={period.selectMinutes}
          date={period.date}
          onDateChange={period.selectDate}
          live={false}
        />
        <div className="mgr-content"><PageLoading /></div>
      </>
    );
  }
  if (summary.error) {
    return (
      <>
        <PageHeader title="Doanh thu" live={false} />
        <div className="mgr-content"><PageError message={summary.error} /></div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Doanh thu"
        subtitle="Tổng hợp doanh số, giá trị đơn hàng và phân bổ theo danh mục"
        minutes={period.minutes}
        onMinutesChange={period.selectMinutes}
        date={period.date}
        onDateChange={period.selectDate}
        lastUpdated={summary.lastUpdated}
      />
      <div className="mgr-content">
        <div className="stat-hero-row">
          <StatHero
            tone="primary"
            icon={IconRevenue}
            label="Tổng doanh thu"
            value={formatMoney(s.total_revenue)}
            sub={period.periodLabel}
            sparkline={sparkRevenue}
            trendPct={compareMetrics.find((m) => m.label === "Doanh thu")?.change}
          />
          <StatHero
            tone="purple"
            label="Đơn hàng"
            value={Number(s.total_purchases || 0).toLocaleString()}
            sub="Giao dịch thành công"
            sparkline={sparkOrders}
            trendPct={compareMetrics.find((m) => m.label === "Đơn hàng")?.change}
          />
          <StatHero
            tone="success"
            label="Giá trị đơn TB"
            value={formatMoney(s.average_order_value)}
            sub="AOV trung bình"
            trendPct={compareMetrics.find((m) => m.label === "AOV")?.change}
          />
        </div>

        <div className="stat-grid">
          <StatCard label="SKU có doanh thu" value={Number(s.unique_products || 0).toLocaleString()} />
        </div>

        {compareMetrics.length > 0 && (
          <DataPanel title="So với nửa kỳ trước" subtitle="Biến động giữa 2 nửa của cùng khung thời gian">
            <div className="delta-chip-row">
              {compareMetrics.map((item) => {
                const up = item.change >= 0;
                return (
                  <span key={item.label} className={`delta-chip ${up ? "up" : "down"}`}>
                    {item.label}: {up ? "+" : ""}{item.change.toFixed(1)}%
                  </span>
                );
              })}
            </div>
          </DataPanel>
        )}

        <div className="overview-main-grid">
          <DataPanel title="Xu hướng doanh thu" subtitle="Doanh thu theo từng phút trong kỳ">
            {trendData.length === 0 ? (
              <EmptyState message="Chưa có dữ liệu trend." />
            ) : (
              <div className="data-panel__body data-panel__body--chart">
                <TrendAreaChart
                  data={trendData}
                  height={300}
                  peakKey="revenue"
                  formatY={formatMoneyShort}
                  formatTooltipValue={(v) => formatMoney(v)}
                  series={[
                    { dataKey: "revenue", name: "Doanh thu", ...SERIES.accent, gradientId: SERIES.accent.gradient },
                  ]}
                />
                {peakRevenuePoint && (
                  <p className="chart-insight-note">
                    Đỉnh doanh thu tại {peakRevenuePoint.time}: {formatMoney(peakRevenuePoint.revenue)}.
                  </p>
                )}
              </div>
            )}
          </DataPanel>

          <div className="overview-right-stack">
            <DataPanel
              title="Doanh thu theo danh mục"
              subtitle={catData.length > 0
                ? `${catData.length} danh mục có doanh thu trong kỳ`
                : "Đóng góp từng danh mục"}
            >
              {catData.length === 0 ? (
                <EmptyState message="Chưa có dữ liệu doanh thu theo danh mục." />
              ) : (
                <div className="data-panel__body data-panel__body--chart">
                  <CategoryBarChart
                    data={catData}
                    height={240}
                    formatValue={(v) => formatMoney(v)}
                  />
                </div>
              )}
            </DataPanel>

            <DataPanel title="Ưu tiên hành động" subtitle="Gợi ý tối ưu doanh thu trong kỳ này">
              <div className="action-list">
                {actionItems.map((item) => (
                  <div key={item.key} className={`action-card ${item.level}`}>
                    <span className="action-card__title">{item.title}</span>
                    <ActionCardValue value={item.value} />
                    <span className="action-card__hint">{item.hint}</span>
                  </div>
                ))}
              </div>
            </DataPanel>
          </div>
        </div>
      </div>
    </>
  );
}
