import { useCallback, useMemo, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { GRID_STROKE, TICK_FILL, TOOLTIP_STYLE } from "../components/charts/chartTheme.js";
import { DataPanel, EmptyState, PageError, PageLoading } from "../components/DataPanel.jsx";
import { PageHeader } from "../components/PageHeader.jsx";
import { IconRevenue } from "../components/icons.jsx";
import { StatCard, StatHero } from "../components/StatCard.jsx";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";
import { useOnKpiUpdate } from "../context/LiveStreamContext.jsx";

const COLORS = ["#f54e00", "#53389e", "#15803d", "#0ea5e9", "#d97706", "#ec4899"];

function money(v) { return `${Number(v || 0).toLocaleString("vi-VN")} ₫`; }

export function RevenuePage() {
  const [minutes, setMinutes] = useState(60);
  const summaryFetcher = useCallback(() => api.revenueSummary(minutes), [minutes]);
  const catFetcher = useCallback(() => api.revenueByCategory(minutes), [minutes]);
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

  if (summary.loading && !summary.data) {
    return (
      <>
        <PageHeader title="Doanh thu" minutes={minutes} onMinutesChange={setMinutes} live={false} />
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

  const s = summary.data?.summary || {};
  const catData = (categories.data?.categories || []).map((c) => ({
    name: c.category || "Khác",
    revenue: Number(c.revenue),
  }));

  return (
    <>
      <PageHeader
        title="Doanh thu"
        subtitle="Tổng hợp doanh số, giá trị đơn hàng và phân bổ theo danh mục"
        minutes={minutes}
        onMinutesChange={setMinutes}
      />
      <div className="mgr-content">
        <div className="stat-hero-row">
          <StatHero
            tone="primary"
            icon={IconRevenue}
            label="Tổng doanh thu"
            value={money(s.total_revenue)}
            sub={`Trong ${minutes} phút gần nhất`}
          />
          <StatHero
            tone="purple"
            label="Đơn hàng"
            value={Number(s.total_purchases || 0).toLocaleString()}
            sub="Giao dịch thành công"
          />
          <StatHero
            tone="success"
            label="Giá trị đơn TB"
            value={money(s.average_order_value)}
            sub="AOV trung bình"
          />
        </div>

        <div className="stat-grid">
          <StatCard label="SKU có doanh thu" value={Number(s.unique_products || 0).toLocaleString()} />
        </div>

        <div className="mgr-cols-2">
          <DataPanel title="Xu hướng doanh thu" subtitle="Doanh thu theo từng phút trong kỳ">
            {trendData.length === 0 ? (
              <EmptyState message="Chưa có dữ liệu trend." />
            ) : (
              <div className="data-panel__body data-panel__body--chart">
                <ResponsiveContainer width="100%" height={260}>
                  <AreaChart data={trendData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#f54e00" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#f54e00" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
                    <XAxis dataKey="time" tick={{ fontSize: 11, fill: TICK_FILL }} />
                    <YAxis tick={{ fontSize: 11, fill: TICK_FILL }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v) => money(v)} contentStyle={TOOLTIP_STYLE} />
                    <Area type="monotone" dataKey="revenue" stroke="#f54e00" fill="url(#gRev)" strokeWidth={2} name="Doanh thu" dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            )}
          </DataPanel>

          <DataPanel title="Doanh thu theo danh mục" subtitle="Contribution từng category">
            {catData.length === 0 ? (
              <EmptyState message="Chưa có dữ liệu doanh thu theo danh mục." />
            ) : (
              <div className="data-panel__body data-panel__body--chart">
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={catData} layout="vertical" margin={{ left: 8, right: 24 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: TICK_FILL }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 11, fill: "#5c6478" }} />
                    <Tooltip formatter={(v) => money(v)} contentStyle={TOOLTIP_STYLE} />
                    <Bar dataKey="revenue" radius={[0, 6, 6, 0]} barSize={22}>
                      {catData.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </DataPanel>
        </div>
      </div>
    </>
  );
}
