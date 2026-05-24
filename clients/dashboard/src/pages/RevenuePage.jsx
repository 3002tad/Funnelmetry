import { useCallback, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { PageHeader } from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";
import { theme } from "../lib/theme.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";

function money(v) {
  return Number(v).toLocaleString("vi-VN") + " ₫";
}

export function RevenuePage({ variant = "admin" }) {
  const t = theme(variant);
  const [minutes, setMinutes] = useState(60);
  const summaryFetcher = useCallback(() => api.revenueSummary(minutes), [minutes]);
  const catFetcher = useCallback(() => api.revenueByCategory(minutes), [minutes]);
  const summary = useAutoRefresh(summaryFetcher);
  const categories = useAutoRefresh(catFetcher);

  if (summary.loading) return <p className="empty">Đang tải…</p>;
  if (summary.error) return <p className="empty">Lỗi: {summary.error}</p>;

  const s = summary.data?.summary || {};
  const trend = (summary.data?.trend || []).map((row) => ({
    time: new Date(row.window_start).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
    revenue: Number(row.revenue),
  }));
  const catData = (categories.data?.categories || []).map((c) => ({
    name: c.category || "Khác",
    revenue: Number(c.revenue),
  }));

  const barColor = variant === "shop" ? "#0d9488" : "#818cf8";
  const gridStroke = variant === "shop" ? "#e2e8f0" : "#27272a";

  return (
    <>
      <PageHeader
        variant={variant}
        title={variant === "shop" ? "Doanh thu" : "Revenue"}
        minutes={minutes}
        onMinutesChange={setMinutes}
      />

      <div className={t.grid}>
        <div className={`${t.card} ${t.highlight}`}>
          <div className="label">Tổng doanh thu</div>
          <div className="value" style={{ fontSize: "1.35rem" }}>{money(s.total_revenue)}</div>
        </div>
        <div className={t.card}>
          <div className="label">Đơn hàng</div>
          <div className="value">{Number(s.total_purchases).toLocaleString()}</div>
        </div>
        <div className={t.card}>
          <div className="label">Giá trị đơn TB</div>
          <div className="value" style={{ fontSize: "1.2rem" }}>{money(s.average_order_value)}</div>
        </div>
        {variant === "admin" && (
          <div className={t.card}>
            <div className="label">Checkout → Purchase</div>
            <div className="value">{(Number(s.checkout_completion_rate) * 100).toFixed(1)}%</div>
          </div>
        )}
      </div>

      {trend.length > 0 && (
        <div className={t.panel}>
          <h3>Doanh thu theo phút</h3>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={trend}>
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis dataKey="time" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => money(v)} />
              <Bar dataKey="revenue" fill={barColor} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {catData.length > 0 && (
        <div className={t.panel}>
          <h3>Theo danh mục</h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={catData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke={gridStroke} />
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(v) => money(v)} />
              <Bar dataKey="revenue" fill={variant === "shop" ? "#14b8a6" : "#34d399"} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </>
  );
}
