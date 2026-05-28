export function EventTypeTable({ rows }) {
  if (!rows?.length) return null;

  const total = rows.reduce((s, r) => s + r.count, 0);
  const max = Math.max(...rows.map((r) => r.count), 1);

  return (
    <div className="bi-rank">
      <div className="bi-rank__summary">
        <div className="bi-funnel__kpi">
          <span className="bi-funnel__kpi-label">Tổng (buffer)</span>
          <strong>{total.toLocaleString("vi-VN")}</strong>
        </div>
        <div className="bi-funnel__kpi bi-funnel__kpi--accent">
          <span className="bi-funnel__kpi-label">Loại event</span>
          <strong>{rows.length}</strong>
        </div>
        <div className="bi-funnel__kpi">
          <span className="bi-funnel__kpi-label">Top type</span>
          <strong>{rows[0]?.label?.slice(0, 20) || "—"}</strong>
        </div>
        <div className="bi-funnel__kpi">
          <span className="bi-funnel__kpi-label">Share top 1</span>
          <strong>{rows[0] ? `${rows[0].sharePct.toFixed(0)}%` : "—"}</strong>
        </div>
      </div>

      <div className="bi-rank__head bi-rank__head--event">
        <span>Loại event</span>
        <span>Mã</span>
        <span>Số lượng</span>
        <span>%</span>
        <span>Volume</span>
      </div>

      {rows.map((r) => {
        const vol = (r.count / max) * 100;
        return (
          <div key={r.type} className="bi-rank__row bi-rank__row--event">
            <span className="bi-rank__label"><strong>{r.label}</strong></span>
            <span><code className="event-code">{r.type}</code></span>
            <span className="bi-rank__num">{r.count.toLocaleString("vi-VN")}</span>
            <span className="bi-rank__pct">{r.sharePct.toFixed(1)}%</span>
            <div className="bi-rank__bar">
              <div className="bi-rank__bar-fill bi-rank__bar-fill--teal" style={{ width: `${Math.max(vol, 4)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
