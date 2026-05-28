import { RankBadge } from "./DataPanel.jsx";

export function SearchQueryTable({ searches }) {
  if (!searches?.length) return null;

  const total = searches.reduce((s, r) => s + Number(r.searches), 0);
  const max = Math.max(...searches.map((r) => Number(r.searches)), 1);

  return (
    <div className="bi-rank">
      <div className="bi-rank__summary">
        <div className="bi-funnel__kpi">
          <span className="bi-funnel__kpi-label">Tổng lượt search</span>
          <strong>{total.toLocaleString("vi-VN")}</strong>
        </div>
        <div className="bi-funnel__kpi">
          <span className="bi-funnel__kpi-label">Từ khóa unique</span>
          <strong>{searches.length}</strong>
        </div>
        <div className="bi-funnel__kpi bi-funnel__kpi--accent">
          <span className="bi-funnel__kpi-label">Top query</span>
          <strong>{(searches[0]?.query || "—").slice(0, 24)}</strong>
        </div>
        <div className="bi-funnel__kpi">
          <span className="bi-funnel__kpi-label">Share top 1</span>
          <strong>
            {total > 0 ? `${((Number(searches[0].searches) / total) * 100).toFixed(0)}%` : "—"}
          </strong>
        </div>
      </div>

      <div className="bi-rank__head">
        <span>#</span>
        <span>Từ khóa</span>
        <span>Lượt</span>
        <span>%</span>
        <span>Volume</span>
      </div>

      {searches.map((r, i) => {
        const n = Number(r.searches);
        const share = total > 0 ? (n / total) * 100 : 0;
        const vol = (n / max) * 100;
        return (
          <div key={r.query} className="bi-rank__row">
            <span className="bi-rank__idx"><RankBadge rank={i + 1} /></span>
            <span className="bi-rank__label"><strong>{r.query}</strong></span>
            <span className="bi-rank__num">{n.toLocaleString("vi-VN")}</span>
            <span className="bi-rank__pct">{share.toFixed(1)}%</span>
            <div className="bi-rank__bar">
              <div className="bi-rank__bar-fill bi-rank__bar-fill--purple" style={{ width: `${Math.max(vol, 4)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
