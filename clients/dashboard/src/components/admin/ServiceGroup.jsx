export function ServiceGroup({ title, services }) {
  if (!services?.length) return null;

  return (
    <div className="admin-panel">
      <h3>{title}</h3>
      <div className="admin-panel-body" style={{ padding: 0 }}>
        {services.map((svc) => (
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
    </div>
  );
}
