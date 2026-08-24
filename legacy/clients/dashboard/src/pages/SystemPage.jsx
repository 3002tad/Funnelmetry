import { useCallback, useMemo } from "react";
import { Sparkline } from "../components/charts/Sparkline.jsx";
import { ServiceGroup } from "../components/admin/ServiceGroup.jsx";
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

function fmtLag(sec) {
  if (sec == null) return "—";
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

function FlowList({ steps }) {
  if (!steps?.length) return null;
  return (
    <ol className="pipeline-flow">
      {steps.map((step, i) => (
        <li key={i} className="pipeline-step">
          <span className="pipeline-arrow">→</span>
          <span style={{ fontSize: "0.85rem", color: "var(--text-muted)" }}>{step}</span>
        </li>
      ))}
    </ol>
  );
}

export function SystemPage() {
  const fetcher = useCallback(() => api.systemPipeline(), []);
  const { data, loading, error, refresh } = useAutoRefresh(fetcher, 10000);

  const sparkValues = useMemo(
    () => (data?.ingest_trend || []).map((r) => r.events),
    [data]
  );

  if (loading && !data) return <p className="empty">Đang tải…</p>;
  if (error) return <p className="empty">Lỗi: {error}</p>;

  const m = data?.metrics || {};
  const lag = data?.lag || {};
  const overall = data?.status || "unknown";
  const env = data?.environment || "—";
  const groups = data?.service_groups || {};
  const flows = data?.flow || {};

  return (
    <>
      <PageHeader
        variant="admin"
        title="Pipeline Monitor"
        subtitle={`${env} · refresh 10s · ${fmtTime(data?.checked_at)}`}
        onRefresh={refresh}
      />

      <div className="admin-panel" style={{ marginBottom: "1rem" }}>
        <div className="admin-panel-body admin-status-bar">
          <span className={`badge ${overall === "healthy" ? "ok" : "degraded"}`}>
            {overall === "healthy" ? "HEALTHY" : "DEGRADED"}
          </span>
          {lag.event_stale && (
            <span className="badge down">Event lag {fmtLag(lag.seconds_since_event)}</span>
          )}
          {lag.kpi_stale && !lag.event_stale && (
            <span className="badge degraded">KPI lag {fmtLag(lag.seconds_since_kpi)}</span>
          )}
          {!lag.event_stale && !lag.kpi_stale && (
            <span className="badge ok">Ingest realtime</span>
          )}
        </div>
      </div>

      <div className="admin-card-grid">
        <div className="admin-card highlight">
          <div className="label">Events / 5m</div>
          <div className="value">{m.events_last_5m ?? "—"}</div>
          <div className="sub">Commerce: {m.commerce_events_5m ?? 0}</div>
        </div>
        <div className="admin-card">
          <div className="label">Total events</div>
          <div className="value">{Number(m.events_total ?? 0).toLocaleString()}</div>
          <div className="sub">Cuối: {fmtTime(m.last_event_at)}</div>
        </div>
        <div className={`admin-card ${lag.kpi_stale ? "warn" : "ok"}`}>
          <div className="label">KPI windows 1h</div>
          <div className="value">{m.kpi_windows_1h ?? "—"}</div>
          <div className="sub">Flush: {fmtTime(m.last_kpi_flush)}</div>
        </div>
        <div className="admin-card">
          <div className="label">Catalog SKUs</div>
          <div className="value">{m.catalog_products ?? "—"}</div>
          <div className="sub">Commerce 24h: {m.commerce_events_24h ?? 0}</div>
        </div>
      </div>

      {sparkValues.length >= 2 && (
        <div className="admin-panel admin-ingest-panel">
          <h3>Ingest trend (60 phút)</h3>
          <div className="admin-panel-body admin-ingest-body">
            <Sparkline
              values={sparkValues}
              width={320}
              height={48}
              stroke="#60a5fa"
              fill="rgba(96, 165, 250, 0.15)"
            />
            <div className="admin-ingest-meta">
              <span>Events / phút</span>
              <strong>
                {sparkValues[sparkValues.length - 1]?.toLocaleString("vi-VN")} gần nhất
              </strong>
            </div>
          </div>
        </div>
      )}

      <div className="mgr-cols-2 admin-flow-cols">
        <div className="admin-panel">
          <h3>Behavior pipeline</h3>
          <FlowList steps={flows.behavior} />
        </div>
        <div className="admin-panel">
          <h3>Commerce pipeline</h3>
          <FlowList steps={flows.commerce} />
        </div>
      </div>

      <ServiceGroup title="Behavior & streaming" services={groups.behavior} />
      <ServiceGroup title="Commerce path" services={groups.commerce} />
      <ServiceGroup title="AI / RAG" services={groups.ai} />
    </>
  );
}
