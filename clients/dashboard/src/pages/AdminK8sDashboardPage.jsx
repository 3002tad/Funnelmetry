import { useMemo } from "react";
import { PageHeader } from "../components/PageHeader.jsx";
import { buildAdminSetupData } from "../lib/adminSetupData.js";

function Cmd({ text }) {
  return <pre className="setup-cmd" style={{ marginBottom: "0.55rem" }}>{text}</pre>;
}

export function AdminK8sDashboardPage() {
  const setup = useMemo(() => buildAdminSetupData(), []);
  const info = setup.k8s_dashboard;

  return (
    <>
      <PageHeader
        variant="admin"
        title="K8s Dashboard"
        subtitle="Mở giao diện Headlamp (Kubernetes UI) ngay từ Admin"
      />

      <div className="admin-panel">
        <h3>{info.title}</h3>
        <div className="admin-panel-body">
          <p style={{ margin: "0 0 0.75rem", fontSize: "0.82rem", color: "var(--text-muted)" }}>
            {info.description} UI này chạy riêng trên cluster, không nhúng trực tiếp vào app
            do cơ chế cert/token bảo mật.
          </p>
          <a
            className="btn btn-primary"
            href="https://localhost:8443"
            target="_blank"
            rel="noreferrer"
          >
            Mở Headlamp UI
          </a>
        </div>
      </div>

      <div className="admin-panel">
        <h3>Thiết lập nhanh</h3>
        <div className="admin-panel-body">
          <ol className="setup-docs">
            <li><strong>Một lệnh (khuyên dùng):</strong></li>
          </ol>
          <Cmd text={info.quick_open} />
          <ol className="setup-docs">
            <li><strong>Cài đặt:</strong></li>
          </ol>
          <Cmd text={info.install} />
          <ol className="setup-docs" start={2}>
            <li><strong>Tạo token đăng nhập:</strong></li>
          </ol>
          <Cmd text={info.token} />
          <ol className="setup-docs" start={3}>
            <li><strong>Port-forward (terminal giữ mở):</strong></li>
          </ol>
          <Cmd text={info.access.split(" → ")[0]} />
          <p style={{ margin: 0, fontSize: "0.78rem", color: "var(--text-faint)" }}>
            Sau đó mở <code>http://localhost:8443</code>, dán token, chọn namespace <strong>realtime</strong>.
          </p>
        </div>
      </div>

      <div className="admin-panel">
        <h3>Tài liệu</h3>
        <div className="admin-panel-body">
          <ul className="setup-docs">
            <li>
              Kubernetes docs:{" "}
              <a href={info.docs_url} target="_blank" rel="noreferrer">{info.docs_url}</a>
            </li>
            <li>Repo guide: <code>{info.readme}</code></li>
          </ul>
        </div>
      </div>
    </>
  );
}
