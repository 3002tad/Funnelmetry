import { useCallback } from "react";
import { PageHeader } from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";

function fmtTime(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function SystemPage() {
  const fetcher = useCallback(() => api.systemPipeline(), []);
  const { data, loading, error, refresh } = useAutoRefresh(fetcher, 10000);

  if (loading && !data) return <p className="empty">Đang tải…</p>;
  if (error) return <p className="empty">Lỗi: {error}</p>;

  const m = data?.metrics || {};
  const overall = data?.status || "unknown";
  const env = data?.environment || "—";

  return (
    <>
      <PageHeader
        variant="admin"
        title="Pipeline Monitor"
        subtitle={`k3s cluster · ${env} · refresh 10s · ${fmtTime(data?.checked_at)}`}
        onRefresh={refresh}
      />

      <div className="admin-panel" style={{ marginBottom: "1rem" }}>
        <div className="admin-panel-body" style={{ display: "flex", alignItems: "center", gap: "0.75rem", flexWrap: "wrap" }}>
          <span className={`badge ${overall === "healthy" ? "ok" : "degraded"}`}>
            {overall === "healthy" ? "HEALTHY" : "DEGRADED"}
          </span>
          <span style={{ fontSize: "0.8rem", color: "var(--text-muted)" }}>
            Probe nội bộ cluster (tracking-api, postgres, qdrant, ollama)
          </span>
        </div>
      </div>

      <div className="admin-card-grid">
        <div className="admin-card highlight">
          <div className="label">Events / 5m</div>
          <div className="value">{m.events_last_5m ?? "—"}</div>
        </div>
        <div className="admin-card">
          <div className="label">Total events</div>
          <div className="value">{Number(m.events_total ?? 0).toLocaleString()}</div>
          <div className="sub">Event cuối: {fmtTime(m.last_event_at)}</div>
        </div>
        <div className="admin-card ok">
          <div className="label">KPI windows 1h</div>
          <div className="value">{m.kpi_windows_1h ?? "—"}</div>
          <div className="sub">Flush KPI: {fmtTime(m.last_kpi_flush)}</div>
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
