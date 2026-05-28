import { ctrLabel, ctrLevel } from "../lib/bannerMetrics.js";

export function BannerPerformanceTable({ banners }) {
  if (!banners?.length) return null;

  const totalImp = banners.reduce((s, b) => s + Number(b.impressions), 0);
  const totalClicks = banners.reduce((s, b) => s + Number(b.clicks), 0);
  const maxImp = Math.max(...banners.map((b) => Number(b.impressions)), 1);
  const avgCtr = totalImp > 0 ? (totalClicks / totalImp) * 100 : 0;

  return (
    <div className="bi-rank bi-rank--banner">
      <div className="bi-rank__summary">
        <div className="bi-funnel__kpi">
          <span className="bi-funnel__kpi-label">Impressions</span>
          <strong>{totalImp.toLocaleString("vi-VN")}</strong>
        </div>
        <div className="bi-funnel__kpi">
          <span className="bi-funnel__kpi-label">Clicks</span>
          <strong>{totalClicks.toLocaleString("vi-VN")}</strong>
        </div>
        <div className="bi-funnel__kpi bi-funnel__kpi--accent">
          <span className="bi-funnel__kpi-label">CTR TB</span>
          <strong>{avgCtr.toFixed(2)}%</strong>
        </div>
        <div className="bi-funnel__kpi">
          <span className="bi-funnel__kpi-label">Banner</span>
          <strong>{banners.length}</strong>
        </div>
      </div>

      <div className="bi-rank__head bi-rank__head--banner">
        <span>Banner</span>
        <span>Impressions</span>
        <span>Clicks</span>
        <span>CTR</span>
        <span>Đánh giá</span>
        <span>Volume</span>
      </div>

      {banners.map((b) => {
        const imp = Number(b.impressions);
        const ctr = Number(b.ctr) * 100;
        const vol = (imp / maxImp) * 100;
        const level = ctrLevel(b.ctr);
        return (
          <div
            key={b.banner_id}
            className={`bi-rank__row bi-rank__row--banner${level === "low" ? " bi-rank__row--warn" : ""}`}
          >
            <span className="bi-rank__label"><strong>{b.banner_id}</strong></span>
            <span className="bi-rank__num">{imp.toLocaleString("vi-VN")}</span>
            <span className="bi-rank__num">{Number(b.clicks).toLocaleString("vi-VN")}</span>
            <span className={`bi-rank__ctr bi-rank__ctr--${level}`}>{ctr.toFixed(2)}%</span>
            <span className={`badge ${level === "ok" ? "ok" : level === "med" ? "degraded" : "down"}`}>
              {ctrLabel(b.ctr)}
            </span>
            <div className="bi-rank__bar">
              <div className="bi-rank__bar-fill bi-rank__bar-fill--purple" style={{ width: `${Math.max(vol, 4)}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
