import { useCallback } from "react";
import { PageHeader } from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";

export function SystemPage() {
  const fetcher = useCallback(() => api.systemPipeline(), []);
  const { data, loading, error, refresh } = useAutoRefresh(fetcher, 10000);

  if (loading && !data) return <p className="empty">Đang tải…</p>;
  if (error) return <p className="empty">Lỗi: {error}</p>;

  const m = data?.metrics || {};

  return (
    <>
      <PageHeader
        variant="admin"
        title="Pipeline Monitor"
        subtitle="Real-time health check — auto refresh 10s"
        onRefresh={refresh}
      />

      <div className="admin-card-grid">
        <div className="admin-card highlight">
          <div className="label">Events / 5m</div>
          <div className="value">{m.events_last_5m ?? "—"}</div>
        </div>
        <div className="admin-card">
          <div className="label">Total events</div>
          <div className="value">{Number(m.events_total ?? 0).toLocaleString()}</div>
        </div>
        <div className="admin-card ok">
          <div className="label">KPI windows 1h</div>
          <div className="value">{m.kpi_windows_1h ?? "—"}</div>
        </div>
        <div className="admin-card">
          <div className="label">Catalog SKUs</div>
          <div className="value">{m.catalog_products ?? "—"}</div>
        </div>
      </div>

      <div className="admin-panel">
        <h3>Data flow</h3>
        <ol className="pipeline-flow">
          {(data?.flow || []).map((step, i) => (
            <li key={i} className="pipeline-step">
              <span className="pipeline-arrow">→</span>
              <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{step}</span>
            </li>
          ))}
        </ol>
      </div>

      <div className="admin-panel">
        <h3>Services</h3>
        {(data?.services || []).map((svc) => (
          <div key={svc.name} className="service-row">
            <span className={`status-dot ${svc.status}`} />
            <span className="service-name">{svc.name}</span>
            <span className="service-detail">{svc.detail || svc.error || svc.url || "—"}</span>
            <span className="service-latency">
              {svc.latency_ms != null ? `${svc.latency_ms}ms` : "—"}
            </span>
            <span className={`badge ${svc.status}`}>{svc.status?.toUpperCase()}</span>
          </div>
        ))}
      </div>
    </>
  );
}
