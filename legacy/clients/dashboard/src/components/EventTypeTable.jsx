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

      <div className="bi-rank__table-wrap">
        <table className="data-table bi-rank-table bi-rank-table--event">
          <colgroup>
            <col className="bi-col-label" />
            <col className="bi-col-code" />
            <col className="bi-col-num" />
            <col className="bi-col-pct" />
            <col className="bi-col-bar" />
          </colgroup>
          <thead>
            <tr>
              <th className="bi-rank-table__col-label">Loại event</th>
              <th className="bi-rank-table__col-code">Mã</th>
              <th className="bi-rank-table__col-num">Số lượng</th>
              <th className="bi-rank-table__col-pct">%</th>
              <th className="bi-rank-table__col-bar">Volume</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const vol = (r.count / max) * 100;
              return (
                <tr key={r.type}>
                  <td className="bi-rank-table__col-label">
                    <strong>{r.label}</strong>
                  </td>
                  <td className="bi-rank-table__col-code">
                    <code className="event-code">{r.type}</code>
                  </td>
                  <td className="bi-rank-table__col-num">{r.count.toLocaleString("vi-VN")}</td>
                  <td className="bi-rank-table__col-pct">{r.sharePct.toFixed(1)}%</td>
                  <td className="bi-rank-table__col-bar">
                    <div className="bi-rank__bar">
                      <div
                        className="bi-rank__bar-fill bi-rank__bar-fill--teal"
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
