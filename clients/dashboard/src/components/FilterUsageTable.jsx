export function FilterUsageTable({ filters }) {
  if (!filters?.length) return null;

  const total = filters.reduce((s, r) => s + Number(r.filter_events), 0);
  const max = Math.max(...filters.map((r) => Number(r.filter_events)), 1);

  return (
    <div className="bi-rank">
      <div className="bi-rank__summary bi-rank__summary--3">
        <div className="bi-funnel__kpi">
          <span className="bi-funnel__kpi-label">Tổng lượt lọc</span>
          <strong>{total.toLocaleString("vi-VN")}</strong>
        </div>
        <div className="bi-funnel__kpi bi-funnel__kpi--accent">
          <span className="bi-funnel__kpi-label">Combo phổ biến</span>
          <strong>
            {`${filters[0]?.category || "all"} / ${filters[0]?.sort_mode || "default"}`.slice(0, 28)}
          </strong>
        </div>
        <div className="bi-funnel__kpi">
          <span className="bi-funnel__kpi-label">Tổ hợp</span>
          <strong>{filters.length}</strong>
        </div>
      </div>

      <div className="bi-rank__head bi-rank__head--filter">
        <span>Danh mục</span>
        <span>Sắp xếp</span>
        <span>Lượt</span>
        <span>%</span>
        <span>Volume</span>
      </div>

      {filters.map((r, i) => {
        const n = Number(r.filter_events);
        const share = total > 0 ? (n / total) * 100 : 0;
        const vol = (n / max) * 100;
        return (
          <div key={`${r.category}-${r.sort_mode}-${i}`} className="bi-rank__row bi-rank__row--filter">
            <span>{r.category || "all"}</span>
            <span>{r.sort_mode || "default"}</span>
            <span className="bi-rank__num">{n.toLocaleString("vi-VN")}</span>
            <span className="bi-rank__pct">{share.toFixed(1)}%</span>
            <div className="bi-rank__bar">
              <div className="bi-rank__bar-fill bi-rank__bar-fill--accent" style={{ width: `${Math.max(vol, 4)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
