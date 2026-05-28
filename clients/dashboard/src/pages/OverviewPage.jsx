import { useCallback, useMemo, useState } from "react";
import { DonutBreakdown } from "../components/charts/DonutBreakdown.jsx";
import { ConversionFunnel } from "../components/charts/ConversionFunnel.jsx";
import { SERIES } from "../components/charts/chartTheme.js";
import { TrendAreaChart } from "../components/charts/TrendAreaChart.jsx";
import { VolumeBarChart } from "../components/charts/VolumeBarChart.jsx";
import { DataPanel, PageError, PageLoading } from "../components/DataPanel.jsx";
import { PageHeader } from "../components/PageHeader.jsx";
import { IconEvents, IconFunnel, IconProducts, IconRevenue } from "../components/icons.jsx";
import { StatCard, StatHero } from "../components/StatCard.jsx";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";
import { useOnKpiUpdate } from "../context/LiveStreamContext.jsx";

const SECONDARY = [
  { key: "add_to_cart", label: "Thêm giỏ", icon: IconProducts },
  { key: "product_views", label: "Xem SP", icon: IconProducts },
  { key: "page_views", label: "Lượt xem trang", icon: IconEvents },
  { key: "checkout_start", label: "Checkout", icon: IconFunnel },
  { key: "total_events", label: "Tổng events", icon: IconEvents },
];

const FUNNEL_LABELS = {
  page_view: "Xem trang",
  product_view: "Xem SP",
  add_to_cart: "Thêm giỏ",
  checkout_start: "Checkout",
  purchase: "Mua hàng",
};

function money(v) {
  return `${Number(v || 0).toLocaleString("vi-VN")} ₫`;
}

function pctChange(current, previous) {
  const prev = Number(previous || 0);
  const curr = Number(current || 0);
  if (prev <= 0) return null;
  return ((curr - prev) / prev) * 100;
}

export function OverviewPage() {
  const [minutes, setMinutes] = useState(60);
  const overviewFetcher = useCallback(() => api.overview(minutes), [minutes]);
  const funnelFetcher = useCallback(() => api.funnel(minutes), [minutes]);
  const { data, loading, error, refresh, lastUpdated } = useAutoRefresh(overviewFetcher, 60000);
  const funnelState = useAutoRefresh(funnelFetcher, 60000);

  useOnKpiUpdate(useCallback(() => {
    refresh();
    funnelState.refresh();
  }, [refresh, funnelState.refresh]));

  const donutData = useMemo(() => {
    if (!data?.kpi) return [];
    const k = data.kpi;
    return [
      { name: "Lượt xem trang", value: Number(k.page_views) },
      { name: "Xem SP", value: Number(k.product_views) },
      { name: "Thêm giỏ", value: Number(k.add_to_cart) },
      { name: "Checkout", value: Number(k.checkout_start) },
      { name: "Mua hàng", value: Number(k.purchases) },
    ].filter((d) => d.value > 0);
  }, [data]);

  const barCompare = useMemo(
    () => SECONDARY.map(({ key, label }) => ({
      name: label,
      value: Number(data?.kpi?.[key] ?? 0),
    })),
    [data]
  );

  const kpi = data?.kpi || {};
  const trend = data?.trend || [];
  const convPct = `${(Number(kpi.conversion_rate || 0) * 100).toFixed(2)}%`;
  const funnelSteps = funnelState.data?.funnel || [];
  const donutTotal = donutData.reduce((s, d) => s + d.value, 0);

  const trendData = (trend || []).map((row) => ({
    time: new Date(row.window_start).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
    sessions: Number(row.unique_sessions),
    purchases: Number(row.purchases),
    page_views: Number(row.page_views),
  }));

  const compareMetrics = useMemo(() => {
    if (trendData.length < 4) return [];
    const mid = Math.floor(trendData.length / 2);
    const prev = trendData.slice(0, mid);
    const curr = trendData.slice(mid);
    const sum = (rows, key) => rows.reduce((acc, r) => acc + Number(r[key] || 0), 0);

    const items = [
      { label: "Phiên truy cập", change: pctChange(sum(curr, "sessions"), sum(prev, "sessions")) },
      { label: "Mua hàng", change: pctChange(sum(curr, "purchases"), sum(prev, "purchases")) },
      { label: "Lượt xem trang", change: pctChange(sum(curr, "page_views"), sum(prev, "page_views")) },
    ];
    return items.filter((i) => i.change != null);
  }, [trendData]);

  const peakMinute = useMemo(() => {
    if (trendData.length === 0) return null;
    return trendData.reduce((max, row) => (row.sessions > max.sessions ? row : max), trendData[0]);
  }, [trendData]);

  const sparkRevenue = useMemo(
    () => (trend || []).map((r) => Number(r.revenue || 0)),
    [trend]
  );
  const sparkSessions = useMemo(
    () => trendData.map((r) => r.sessions),
    [trendData]
  );
  const sparkPurchases = useMemo(
    () => trendData.map((r) => r.purchases),
    [trendData]
  );
  const actionItems = useMemo(() => {
    const cart = Number(kpi.add_to_cart || 0);
    const checkout = Number(kpi.checkout_start || 0);
    const purchases = Number(kpi.purchases || 0);
    const pageViews = Number(kpi.page_views || 0);
    const dropCheckout = checkout > 0 ? (1 - purchases / checkout) * 100 : 0;
    const cartRate = pageViews > 0 ? (cart / pageViews) * 100 : 0;

    return [
      {
        key: "checkout-drop",
        level: dropCheckout >= 55 ? "high" : dropCheckout >= 35 ? "medium" : "good",
        title: "Rớt ở checkout",
        value: `${dropCheckout.toFixed(1)}%`,
        hint: dropCheckout >= 55
          ? "Rà lỗi thanh toán hoặc bước checkout cuối."
          : "Tỷ lệ rớt checkout đang trong ngưỡng ổn.",
      },
      {
        key: "cart-rate",
        level: cartRate < 3 ? "medium" : "good",
        title: "Tỷ lệ thêm giỏ",
        value: `${cartRate.toFixed(1)}%`,
        hint: cartRate < 3
          ? "Cân nhắc tối ưu CTA/ảnh/giá ở trang sản phẩm."
          : "Tỷ lệ thêm giỏ tốt so với lượt xem trang.",
      },
      {
        key: "peak-minute",
        level: "good",
        title: "Khung giờ cao điểm",
        value: peakMinute ? peakMinute.time : "—",
        hint: peakMinute
          ? `${peakMinute.sessions.toLocaleString()} phiên tại thời điểm cao nhất.`
          : "Chưa đủ dữ liệu để xác định đỉnh.",
      },
    ];
  }, [kpi, peakMinute]);

  if (loading && !data) {
    return (
      <>
        <PageHeader title="Tổng quan" subtitle="Đang tải dữ liệu…" minutes={minutes} onMinutesChange={setMinutes} live={false} />
        <div className="mgr-content"><PageLoading /></div>
      </>
    );
  }
  if (error) {
    return (
      <>
        <PageHeader title="Tổng quan" minutes={minutes} onMinutesChange={setMinutes} onRefresh={refresh} live={false} />
        <div className="mgr-content"><PageError message={error} /></div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Tổng quan"
        subtitle="Theo dõi hành vi khách hàng, doanh thu và chuyển đổi theo thời gian thực"
        minutes={minutes}
        onMinutesChange={setMinutes}
        onRefresh={refresh}
        lastUpdated={lastUpdated}
      />
      <div className="mgr-content">
        <div className="stat-hero-row">
          <StatHero
            tone="primary"
            icon={IconRevenue}
            label="Doanh thu"
            value={money(kpi.total_revenue)}
            sub={`${Number(kpi.purchases || 0).toLocaleString()} đơn hàng`}
            sparkline={sparkRevenue}
          />
          <StatHero
            tone="purple"
            icon={IconEvents}
            label="Phiên truy cập"
            value={Number(kpi.unique_sessions || 0).toLocaleString()}
            sub={`${Number(kpi.page_views || 0).toLocaleString()} lượt xem trang`}
            sparkline={sparkSessions}
            trendPct={compareMetrics.find((m) => m.label === "Phiên truy cập")?.change}
          />
          <StatHero
            tone="success"
            icon={IconFunnel}
            label="Tỷ lệ chuyển đổi"
            value={convPct}
            sub="Mua hàng / phiên"
            sparkline={sparkPurchases}
            trendPct={compareMetrics.find((m) => m.label === "Mua hàng")?.change}
          />
        </div>

        <div className="stat-grid">
          {SECONDARY.map(({ key, label, icon }) => (
            <StatCard
              key={key}
              label={label}
              value={Number(kpi[key] ?? 0).toLocaleString()}
              icon={icon}
            />
          ))}
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
          {trendData.length > 0 && (
            <DataPanel title="Biểu đồ hoạt động" subtitle="Phiên, mua hàng và lượt xem trang theo phút">
              <div className="data-panel__body data-panel__body--chart">
                <TrendAreaChart
                  data={trendData}
                  height={300}
                  peakKey="sessions"
                  series={[
                    { dataKey: "sessions", name: "Phiên", ...SERIES.purple, gradientId: SERIES.purple.gradient },
                    { dataKey: "purchases", name: "Mua hàng", ...SERIES.success, gradientId: SERIES.success.gradient },
                  ]}
                />
                {peakMinute && (
                  <p className="chart-insight-note">
                    Đỉnh phiên truy cập tại {peakMinute.time}: {peakMinute.sessions.toLocaleString()} phiên.
                  </p>
                )}
              </div>
            </DataPanel>
          )}

          <div className="overview-right-stack">
            {donutData.length > 0 && (
              <DataPanel title="Phân bổ hành vi" subtitle="Tỷ trọng từng loại tương tác trong kỳ">
                <div className="data-panel__body">
                  <DonutBreakdown
                    data={donutData}
                    height={220}
                    centerLabel={donutTotal.toLocaleString()}
                  />
                </div>
              </DataPanel>
            )}
            <DataPanel title="Ưu tiên hành động" subtitle="Gợi ý nhanh để tối ưu ngay trong kỳ này">
              <div className="action-list">
                {actionItems.map((item) => (
                  <div key={item.key} className={`action-card ${item.level}`}>
                    <span className="action-card__title">{item.title}</span>
                    <strong className="action-card__value">{item.value}</strong>
                    <span className="action-card__hint">{item.hint}</span>
                  </div>
                ))}
              </div>
            </DataPanel>
          </div>
        </div>

        <div className="mgr-cols-2 mgr-cols-2--bi">
          {funnelSteps.length > 0 && (
            <DataPanel title="Phễu chuyển đổi" subtitle="Conversion theo bước — xem trang → mua hàng">
              <div className="data-panel__body data-panel__body--flush">
                <ConversionFunnel steps={funnelSteps} labels={FUNNEL_LABELS} compact />
              </div>
            </DataPanel>
          )}

          <DataPanel title="So sánh chỉ số" subtitle="Volume từng bước trong kỳ đã chọn">
            <div className="data-panel__body data-panel__body--chart">
              <VolumeBarChart data={barCompare} height={280} />
            </div>
          </DataPanel>
        </div>
      </div>
    </>
  );
}
