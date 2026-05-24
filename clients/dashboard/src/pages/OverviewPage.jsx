import { useCallback, useState } from "react";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { PageHeader } from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";
import { theme } from "../lib/theme.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";

const ADMIN_KPIS = [
  { key: "total_events", label: "Total Events" },
  { key: "page_views", label: "Page Views" },
  { key: "product_views", label: "Product Views" },
  { key: "unique_sessions", label: "Sessions", highlight: true },
  { key: "searches", label: "Searches" },
  { key: "add_to_cart", label: "Add to Cart" },
  { key: "checkout_start", label: "Checkout" },
  { key: "purchases", label: "Purchases", highlight: true },
  { key: "total_revenue", label: "Revenue", format: (v) => `${Number(v).toLocaleString("vi-VN")} ₫`, highlight: true },
  { key: "conversion_rate", label: "Conv. Rate", format: (v) => `${(Number(v) * 100).toFixed(2)}%` },
];

const SHOP_KPIS = [
  { key: "total_revenue", label: "Doanh thu", format: (v) => `${Number(v).toLocaleString("vi-VN")} ₫`, highlight: true },
  { key: "purchases", label: "Đơn hàng", highlight: true },
  { key: "unique_sessions", label: "Khách (sessions)" },
  { key: "add_to_cart", label: "Thêm giỏ" },
  { key: "conversion_rate", label: "Tỷ lệ chuyển đổi", format: (v) => `${(Number(v) * 100).toFixed(2)}%` },
];

export function OverviewPage({ variant = "admin" }) {
  const t = theme(variant);
  const [minutes, setMinutes] = useState(variant === "shop" ? 60 : 30);
  const fetcher = useCallback(() => api.overview(minutes), [minutes]);
  const { data, loading, error, refresh } = useAutoRefresh(fetcher);

  if (loading) return <p className="empty">Đang tải…</p>;
  if (error) return <p className="empty">Lỗi: {error}</p>;

  const { kpi, trend } = data;
  const cards = variant === "shop" ? SHOP_KPIS : ADMIN_KPIS;
  const trendData = (trend || []).map((row) => ({
    time: new Date(row.window_start).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
    events: Number(row.total_events),
    sessions: Number(row.unique_sessions),
    purchases: Number(row.purchases),
  }));

  return (
    <>
      <PageHeader
        variant={variant}
        title={variant === "shop" ? "Tổng quan cửa hàng" : "Overview"}
        subtitle={variant === "shop" ? "Số liệu kinh doanh realtime từ pipeline tracking" : "KPI pipeline realtime"}
        minutes={minutes}
        onMinutesChange={setMinutes}
        onRefresh={refresh}
        periodOptions={variant === "shop" ? [30, 60, 180, 720, 1440] : [15, 30, 60, 180, 720, 1440]}
      />

      <div className={t.grid}>
        {cards.map(({ key, label, highlight, format }) => (
          <div key={key} className={`${t.card}${highlight ? ` ${t.highlight}` : ""}`}>
            <div className="label">{label}</div>
            <div className="value">
              {format ? format(Number(kpi[key])) : Number(kpi[key] ?? 0).toLocaleString()}
            </div>
          </div>
        ))}
      </div>

      {trendData.length > 0 && (
        <div className={t.panel}>
          <h3>Biểu đồ theo phút</h3>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke={variant === "shop" ? "#e2e8f0" : "#27272a"} />
              <XAxis dataKey="time" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Line type="monotone" dataKey="sessions" stroke={variant === "shop" ? "#0d9488" : "#34d399"} dot={false} strokeWidth={2} name="Sessions" />
              <Line type="monotone" dataKey="purchases" stroke="#f59e0b" dot={false} strokeWidth={2} name="Purchases" />
              {variant === "admin" && (
                <Line type="monotone" dataKey="events" stroke="#818cf8" dot={false} strokeWidth={2} name="Events" />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  );
}
