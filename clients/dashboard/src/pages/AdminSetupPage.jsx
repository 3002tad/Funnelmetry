import { useCallback, useMemo, useState } from "react";
import { PageHeader } from "../components/PageHeader.jsx";
import { buildAdminSetupData } from "../lib/adminSetupData.js";
import { api } from "../lib/api.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";

function EnvBlock({ title, vars }) {
  const lines = Object.entries(vars || {}).map(([k, v]) => `${k}=${v}`);
  const text = lines.join("\n");

  return (
    <div className="setup-env-block">
      <div className="setup-env-block__head">
        <strong>{title}</strong>
        <button
          type="button"
          className="btn btn-ghost"
          style={{ fontSize: "0.72rem", padding: "0.25rem 0.5rem" }}
          onClick={() => navigator.clipboard?.writeText(text)}
        >
          Copy
        </button>
      </div>
      <pre>{text}</pre>
    </div>
  );
}

export function AdminSetupPage() {
  const staticData = useMemo(() => buildAdminSetupData(), []);
  const [apiNote, setApiNote] = useState(null);

  const fetcher = useCallback(async () => {
    try {
      const remote = await api.systemSetup();
      setApiNote(null);
      return remote;
    } catch {
      setApiNote("API /api/system/setup chưa có trên server — hiển thị dữ liệu tĩnh (cập nhật dashboard-api trên k3s để đồng bộ).");
      return staticData;
    }
  }, [staticData]);

  const { data, loading, refresh } = useAutoRefresh(fetcher, 0);
  const view = data || staticData;

  if (loading && !data) {
    return (
      <>
        <PageHeader variant="admin" title="Demo & Ports" live={false} />
        <p className="empty">Đang tải…</p>
      </>
    );
  }

  return (
    <>
      <PageHeader
        variant="admin"
        title="Demo & Ports"
        subtitle="NodePort, env mẫu cho Laptop 2 → WSL2 k3s"
        onRefresh={refresh}
      />

      {apiNote && (
        <div className="admin-panel" style={{ marginBottom: "1rem" }}>
          <div className="admin-panel-body">
            <span className="badge degraded">Offline API</span>
            <span style={{ marginLeft: "0.5rem", fontSize: "0.8rem", color: "var(--text-muted)" }}>
              {apiNote}
            </span>
          </div>
        </div>
      )}

      <div className="admin-panel">
        <h3>NodePort (từ Windows / Laptop 2)</h3>
        <div className="admin-panel-body--flush">
          <table className="data-table">
            <thead>
              <tr>
                <th>Dịch vụ</th>
                <th>NodePort</th>
                <th>In-cluster</th>
                <th>Mục đích</th>
              </tr>
            </thead>
            <tbody>
              {(view.ports || []).map((p) => (
                <tr key={p.service}>
                  <td><strong>{p.service}</strong></td>
                  <td className="mono">{p.nodePort}</td>
                  <td className="mono" style={{ fontSize: "0.75rem" }}>{p.internal}</td>
                  <td>{p.use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="admin-panel">
        <h3>Chỉ trong cluster</h3>
        <div className="admin-panel-body">
          <div className="setup-chip-row">
            {(view.cluster_only || []).map((p) => (
              <span key={p.service} className="setup-chip">
                {p.service}:{p.port}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="admin-panel">
        <h3>Env mẫu</h3>
        <p style={{ padding: "0 1rem", margin: 0, fontSize: "0.8rem", color: "var(--text-muted)" }}>
          WSL IP gợi ý: <code className="mono">{view.wsl_ip_hint}</code> — lấy từ{" "}
          <code>VITE_DASHBOARD_API_URL</code> hoặc cập nhật <code>WSL_IP</code> trong infra/.env
        </p>
        <div className="admin-panel-body" style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
          <EnvBlock title="clients/web-shop/.env" vars={view.env_examples?.web_shop} />
          <EnvBlock title="clients/dashboard (Vite)" vars={view.env_examples?.dashboard_dev} />
        </div>
      </div>

      <div className="admin-panel">
        <h3>Deploy</h3>
        <div className="admin-panel-body">
          <pre className="setup-cmd">{view.deploy}</pre>
          <ul className="setup-docs">
            {(view.docs || []).map((d) => (
              <li key={d}><code>{d}</code></li>
            ))}
          </ul>
        </div>
      </div>

      {view.k8s_dashboard && (
        <div className="admin-panel">
          <h3>{view.k8s_dashboard.title}</h3>
          <div className="admin-panel-body">
            <p style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
              {view.k8s_dashboard.description}{" "}
              <a href={view.k8s_dashboard.docs_url} target="_blank" rel="noreferrer">
                Tài liệu Kubernetes
              </a>
            </p>
            <ul className="setup-docs" style={{ marginBottom: "0.75rem" }}>
              <li><strong>Cài (Helm, WSL):</strong> <code>{view.k8s_dashboard.install}</code></li>
              <li><strong>Token login:</strong> <code>{view.k8s_dashboard.token}</code></li>
              <li><strong>Truy cập:</strong> <code>{view.k8s_dashboard.access}</code></li>
            </ul>
            <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--text-faint)" }}>
              Chi tiết: <code>{view.k8s_dashboard.readme}</code> — chọn namespace <strong>realtime</strong> sau khi đăng nhập.
            </p>
          </div>
        </div>
      )}
    </>
  );
}
