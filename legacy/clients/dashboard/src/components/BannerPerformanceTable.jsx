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

      <div className="bi-rank__table-wrap">
        <table className="data-table bi-rank-table bi-rank-table--banner">
          <colgroup>
            <col className="bi-col-label" />
            <col className="bi-col-num" />
            <col className="bi-col-num" />
            <col className="bi-col-num" />
            <col className="bi-col-badge" />
            <col className="bi-col-bar" />
          </colgroup>
          <thead>
            <tr>
              <th className="bi-rank-table__col-label">Banner</th>
              <th className="bi-rank-table__col-num">Impressions</th>
              <th className="bi-rank-table__col-num">Clicks</th>
              <th className="bi-rank-table__col-num">CTR</th>
              <th className="bi-rank-table__col-badge">Đánh giá</th>
              <th className="bi-rank-table__col-bar">Volume</th>
            </tr>
          </thead>
          <tbody>
            {banners.map((b) => {
              const imp = Number(b.impressions);
              const ctr = Number(b.ctr) * 100;
              const vol = (imp / maxImp) * 100;
              const level = ctrLevel(b.ctr);
              return (
                <tr
                  key={b.banner_id}
                  className={level === "low" ? "bi-rank-table__row--warn" : undefined}
                >
                  <td className="bi-rank-table__col-label">
                    <strong>{b.banner_id}</strong>
                  </td>
                  <td className="bi-rank-table__col-num">{imp.toLocaleString("vi-VN")}</td>
                  <td className="bi-rank-table__col-num">
                    {Number(b.clicks).toLocaleString("vi-VN")}
                  </td>
                  <td className={`bi-rank-table__col-num bi-rank__ctr bi-rank__ctr--${level}`}>
                    {ctr.toFixed(2)}%
                  </td>
                  <td className="bi-rank-table__col-badge">
                    <span className={`badge ${level === "ok" ? "ok" : level === "med" ? "degraded" : "down"}`}>
                      {ctrLabel(b.ctr)}
                    </span>
                  </td>
                  <td className="bi-rank-table__col-bar">
                    <div className="bi-rank__bar">
                      <div
                        className="bi-rank__bar-fill bi-rank__bar-fill--purple"
                        style={{ width: `${Math.max(vol, 4)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
