import { useCallback, useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { DonutBreakdown } from "../components/charts/DonutBreakdown.jsx";
import { FunnelShape } from "../components/charts/FunnelShape.jsx";
import { CHART_COLORS, GRID_STROKE, TICK_FILL, TOOLTIP_STYLE } from "../components/charts/chartTheme.js";
import { DataPanel, PageError, PageLoading } from "../components/DataPanel.jsx";
import { PageHeader } from "../components/PageHeader.jsx";
import { IconEvents, IconFunnel, IconProducts, IconRevenue } from "../components/icons.jsx";
import { StatCard, StatHero } from "../components/StatCard.jsx";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";

const SECONDARY = [
  { key: "add_to_cart", label: "Thêm giỏ", icon: IconProducts },
  { key: "product_views", label: "Xem SP", icon: IconProducts },
  { key: "page_views", label: "Page views", icon: IconEvents },
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

export function OverviewPage() {
  const [minutes, setMinutes] = useState(60);
  const overviewFetcher = useCallback(() => api.overview(minutes), [minutes]);
  const funnelFetcher = useCallback(() => api.funnel(minutes), [minutes]);
  const { data, loading, error, refresh } = useAutoRefresh(overviewFetcher);
  const funnelState = useAutoRefresh(funnelFetcher);

  const donutData = useMemo(() => {
    if (!data?.kpi) return [];
    const k = data.kpi;
    return [
      { name: "Page views", value: Number(k.page_views) },
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

  const { kpi, trend } = data;
  const convPct = `${(Number(kpi.conversion_rate || 0) * 100).toFixed(2)}%`;
  const funnelSteps = funnelState.data?.funnel || [];
  const donutTotal = donutData.reduce((s, d) => s + d.value, 0);

  const trendData = (trend || []).map((row) => ({
    time: new Date(row.window_start).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
    sessions: Number(row.unique_sessions),
    purchases: Number(row.purchases),
    page_views: Number(row.page_views),
  }));

  return (
    <>
      <PageHeader
        title="Tổng quan"
        subtitle="Theo dõi hành vi khách hàng, doanh thu và chuyển đổi theo thời gian thực"
        minutes={minutes}
        onMinutesChange={setMinutes}
        onRefresh={refresh}
      />
      <div className="mgr-content">
        <div className="stat-hero-row">
          <StatHero
            tone="primary"
            icon={IconRevenue}
            label="Doanh thu"
            value={money(kpi.total_revenue)}
            sub={`${Number(kpi.purchases || 0).toLocaleString()} đơn hàng`}
          />
          <StatHero
            tone="purple"
            icon={IconEvents}
            label="Sessions"
            value={Number(kpi.unique_sessions || 0).toLocaleString()}
            sub={`${Number(kpi.page_views || 0).toLocaleString()} page views`}
          />
          <StatHero
            tone="success"
            icon={IconFunnel}
            label="Tỷ lệ chuyển đổi"
            value={convPct}
            sub="Mua hàng / session"
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

        <div className="mgr-cols-2">
          {trendData.length > 0 && (
            <DataPanel title="Biểu đồ hoạt động" subtitle="Sessions, mua hàng và page views theo phút">
              <div className="data-panel__body data-panel__body--chart">
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gSess" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#53389e" stopOpacity={0.25} />
                        <stop offset="95%" stopColor="#53389e" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gBuy" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#15803d" stopOpacity={0.2} />
                        <stop offset="95%" stopColor="#15803d" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                    <XAxis dataKey="time" tick={{ fontSize: 11, fill: TICK_FILL }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: TICK_FILL }} axisLine={false} tickLine={false} width={40} />
                    <Tooltip contentStyle={TOOLTIP_STYLE} />
                    <Legend wrapperStyle={{ fontSize: "0.78rem", paddingTop: 8 }} />
                    <Area type="monotone" dataKey="sessions" stroke="#53389e" fill="url(#gSess)" strokeWidth={2} name="Sessions" dot={false} />
                    <Area type="monotone" dataKey="purchases" stroke="#15803d" fill="url(#gBuy)" strokeWidth={2} name="Mua hàng" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </DataPanel>
          )}

          {donutData.length > 0 && (
            <DataPanel title="Phân bổ hành vi" subtitle="Tỷ trọng từng loại tương tác trong kỳ">
              <div className="data-panel__body">
                <DonutBreakdown
                  data={donutData}
                  height={200}
                  centerLabel={donutTotal.toLocaleString()}
                />
              </div>
            </DataPanel>
          )}
        </div>

        <div className="mgr-cols-2">
          {funnelSteps.length > 0 && (
            <DataPanel title="Phễu chuyển đổi" subtitle="Hành trình từ xem trang → mua hàng">
              <div className="data-panel__body">
                <FunnelShape steps={funnelSteps} labels={FUNNEL_LABELS} />
              </div>
            </DataPanel>
          )}

          <DataPanel title="So sánh chỉ số" subtitle="Volume từng bước trong kỳ đã chọn">
            <div className="data-panel__body data-panel__body--chart">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={barCompare} margin={{ top: 8, right: 8, left: 0, bottom: 24 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 10, fill: TICK_FILL }} interval={0} angle={-12} textAnchor="end" height={48} />
                  <YAxis tick={{ fontSize: 11, fill: TICK_FILL }} />
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                  <Bar dataKey="value" fill={CHART_COLORS[0]} radius={[6, 6, 0, 0]} name="Số lượng" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </DataPanel>
        </div>
      </div>
    </>
  );
}
