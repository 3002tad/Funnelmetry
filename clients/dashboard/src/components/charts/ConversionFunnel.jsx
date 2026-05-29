import { Fragment } from "react";
import { buildFunnelRows } from "../../lib/funnelMetrics.js";

function fmt(n) {
  return Number(n).toLocaleString("vi-VN");
}

function dropClass(pct) {
  if (pct >= 50) return "bi-funnel__drop--high";
  if (pct >= 30) return "bi-funnel__drop--med";
  return "bi-funnel__drop--low";
}

/**
 * BI conversion funnel — table + volume bars + step connectors (Amplitude / GA4 style).
 */
export function ConversionFunnel({ steps, labels = {}, compact = false }) {
  const { rows, summary } = buildFunnelRows(steps, labels);
  if (!rows.length || !summary) return null;

  const colCount = compact ? 5 : 6;

  return (
    <div className={`bi-funnel${compact ? " bi-funnel--compact" : ""}`}>
      {!compact && (
        <div className="bi-funnel__summary">
          <div className="bi-funnel__kpi">
            <span className="bi-funnel__kpi-label">Vào phễu</span>
            <strong>{fmt(summary.top)}</strong>
            <span className="bi-funnel__kpi-hint">Bước đầu</span>
          </div>
          <div className="bi-funnel__kpi">
            <span className="bi-funnel__kpi-label">Hoàn tất mua</span>
            <strong>{fmt(summary.purchase)}</strong>
            <span className="bi-funnel__kpi-hint">Bước cuối</span>
          </div>
          <div className="bi-funnel__kpi bi-funnel__kpi--accent">
            <span className="bi-funnel__kpi-label">Conversion tổng</span>
            <strong>{summary.overallConvPct.toFixed(2)}%</strong>
            <span className="bi-funnel__kpi-hint">Mua / vào phễu</span>
          </div>
          <div className={`bi-funnel__kpi${summary.worstStep ? " bi-funnel__kpi--warn" : ""}`}>
            <span className="bi-funnel__kpi-label">Rớt mạnh nhất</span>
            <strong>
              {summary.worstStep
                ? `−${summary.worstStep.dropPct.toFixed(1)}%`
                : "—"}
            </strong>
            <span className="bi-funnel__kpi-hint">
              {summary.worstStep?.label || "—"}
            </span>
          </div>
        </div>
      )}

      <div className="bi-funnel__table-wrap">
        <table
          className={`data-table bi-funnel-table${compact ? " bi-funnel-table--compact" : ""}`}
        >
          <colgroup>
            <col className="bi-col-step" />
            <col className="bi-col-num" />
            <col className="bi-col-pct" />
            {!compact && <col className="bi-col-pct" />}
            <col className="bi-col-pct" />
            <col className="bi-col-bar" />
          </colgroup>
          <thead>
            <tr>
              <th className="bi-funnel-table__col-step">Bước</th>
              <th className="bi-funnel-table__col-num">Người dùng</th>
              <th className="bi-funnel-table__col-pct">% Tổng</th>
              {!compact && <th className="bi-funnel-table__col-pct">Chuyển tiếp</th>}
              <th className="bi-funnel-table__col-pct">Rớt bước</th>
              <th className="bi-funnel-table__col-bar">Volume</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <Fragment key={row.step}>
                {i > 0 && (
                  <tr className="bi-funnel-table__connector">
                    <td colSpan={colCount}>
                      <div className="bi-funnel__connector" aria-hidden>
                        <span className="bi-funnel__connector-line" />
                        <span className="bi-funnel__connector-text">
                          Chuyển tiếp <strong>{row.stepConvPct.toFixed(1)}%</strong>
                          {row.lost > 0 && (
                            <> · Mất <strong>{fmt(row.lost)}</strong></>
                          )}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
                <tr className={row.isWorst ? "bi-funnel-table__row--worst" : undefined}>
                  <td className="bi-funnel-table__col-step">
                    <div className="bi-funnel__step">
                      <span className="bi-funnel__index">{row.index}</span>
                      <span className="bi-funnel__name">{row.label}</span>
                      {row.isWorst && <span className="bi-funnel__badge">Rớt nhiều</span>}
                    </div>
                  </td>
                  <td className="bi-funnel-table__col-num">{fmt(row.count)}</td>
                  <td className="bi-funnel-table__col-pct">{row.ofTotalPct.toFixed(1)}%</td>
                  {!compact && (
                    <td className="bi-funnel-table__col-pct">
                      {row.isFirst ? "—" : `${row.stepConvPct.toFixed(1)}%`}
                    </td>
                  )}
                  <td
                    className={`bi-funnel-table__col-pct bi-funnel__drop ${
                      row.isFirst ? "bi-funnel__drop--na" : dropClass(row.dropPct)
                    }`}
                  >
                    {row.isFirst ? "—" : `−${row.dropPct.toFixed(1)}%`}
                  </td>
                  <td className="bi-funnel-table__col-bar">
                    <div className="bi-funnel__bar">
                      <div
                        className="bi-funnel__bar-fill"
                        style={{ width: `${Math.max(row.ofTotalPct, 2)}%` }}
                      />
                    </div>
                  </td>
                </tr>
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
