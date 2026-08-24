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

      <div className="bi-rank__table-wrap">
        <table className="data-table bi-rank-table bi-rank-table--filter">
          <colgroup>
            <col className="bi-col-label" />
            <col className="bi-col-label" />
            <col className="bi-col-num" />
            <col className="bi-col-pct" />
            <col className="bi-col-bar" />
          </colgroup>
          <thead>
            <tr>
              <th className="bi-rank-table__col-label">Danh mục</th>
              <th className="bi-rank-table__col-label">Sắp xếp</th>
              <th className="bi-rank-table__col-num">Lượt</th>
              <th className="bi-rank-table__col-pct">%</th>
              <th className="bi-rank-table__col-bar">Volume</th>
            </tr>
          </thead>
          <tbody>
            {filters.map((r, i) => {
              const n = Number(r.filter_events);
              const share = total > 0 ? (n / total) * 100 : 0;
              const vol = (n / max) * 100;
              return (
                <tr key={`${r.category}-${r.sort_mode}-${i}`}>
                  <td className="bi-rank-table__col-label">{r.category || "all"}</td>
                  <td className="bi-rank-table__col-label">{r.sort_mode || "default"}</td>
                  <td className="bi-rank-table__col-num">{n.toLocaleString("vi-VN")}</td>
                  <td className="bi-rank-table__col-pct">{share.toFixed(1)}%</td>
                  <td className="bi-rank-table__col-bar">
                    <div className="bi-rank__bar">
                      <div
                        className="bi-rank__bar-fill bi-rank__bar-fill--accent"
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
