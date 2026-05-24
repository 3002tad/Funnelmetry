import { useCallback } from "react";
import { PageHeader } from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";

const STATUS = {
  ok: { bg: "rgba(34,197,94,0.15)", color: "#4ade80", label: "OK" },
  degraded: { bg: "rgba(234,179,8,0.15)", color: "#fbbf24", label: "Degraded" },
  down: { bg: "rgba(239,68,68,0.15)", color: "#f87171", label: "Down" },
  unknown: { bg: "#27272a", color: "#94a3b8", label: "?" },
};

function Badge({ status }) {
  const s = STATUS[status] || STATUS.unknown;
  return <span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
}

export function SystemPage() {
  const fetcher = useCallback(() => api.systemPipeline(), []);
  const { data, loading, error, refresh } = useAutoRefresh(fetcher, 10000);

  if (loading && !data) return <p className="empty">Đang tải…</p>;
  if (error) return <p className="empty">Lỗi: {error}</p>;

  const m = data?.metrics || {};

  return (
    <>
      <PageHeader
        title="Pipeline System"
        subtitle="Health check các service trong stack"
        onRefresh={refresh}
      />

      <div className="admin-card-grid">
        <div className="admin-card"><div className="label">Events 5 phút</div><div className="value">{m.events_last_5m}</div></div>
        <div className="admin-card"><div className="label">Tổng events</div><div className="value">{m.events_total}</div></div>
        <div className="admin-card highlight"><div className="label">KPI 1h</div><div className="value">{m.kpi_windows_1h}</div></div>
        <div className="admin-card"><div className="label">Catalog</div><div className="value">{m.catalog_products}</div></div>
      </div>

      <div className="admin-panel">
        <h3>Luồng dữ liệu</h3>
        <ol className="pipeline-flow">
          {(data?.flow || []).map((step, i) => <li key={i}>{step}</li>)}
        </ol>
      </div>

      <div className="admin-panel">
        <h3>Services</h3>
        <table className="data-table">
          <thead>
            <tr><th>Service</th><th>Status</th><th>Latency</th><th>Chi tiết</th></tr>
          </thead>
          <tbody>
            {(data?.services || []).map((svc) => (
              <tr key={svc.name}>
                <td><strong>{svc.name}</strong></td>
                <td><Badge status={svc.status} /></td>
                <td>{svc.latency_ms != null ? `${svc.latency_ms} ms` : "—"}</td>
                <td className="muted">{svc.detail || svc.error || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
