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

      <div className="bi-funnel__table" role="table">
        <div className="bi-funnel__head" role="row">
          <span role="columnheader">Bước</span>
          <span role="columnheader">Người dùng</span>
          <span role="columnheader">% Tổng</span>
          {!compact && <span role="columnheader">Chuyển tiếp</span>}
          <span role="columnheader">Rớt bước</span>
          <span role="columnheader" className="bi-funnel__head-bar">Volume</span>
        </div>

        {rows.map((row, i) => (
          <div key={row.step} className="bi-funnel__block">
            {i > 0 && (
              <div className="bi-funnel__connector" aria-hidden>
                <span className="bi-funnel__connector-line" />
                <span className="bi-funnel__connector-text">
                  Chuyển tiếp <strong>{row.stepConvPct.toFixed(1)}%</strong>
                  {row.lost > 0 && (
                    <> · Mất <strong>{fmt(row.lost)}</strong></>
                  )}
                </span>
              </div>
            )}
            <div
              className={`bi-funnel__row${row.isWorst ? " bi-funnel__row--worst" : ""}`}
              role="row"
            >
              <div className="bi-funnel__step" role="cell">
                <span className="bi-funnel__index">{row.index}</span>
                <span className="bi-funnel__name">{row.label}</span>
                {row.isWorst && <span className="bi-funnel__badge">Rớt nhiều</span>}
              </div>
              <span className="bi-funnel__count" role="cell">{fmt(row.count)}</span>
              <span className="bi-funnel__pct" role="cell">{row.ofTotalPct.toFixed(1)}%</span>
              {!compact && (
                <span className="bi-funnel__conv" role="cell">
                  {row.isFirst ? "—" : `${row.stepConvPct.toFixed(1)}%`}
                </span>
              )}
              <span
                className={`bi-funnel__drop ${row.isFirst ? "bi-funnel__drop--na" : dropClass(row.dropPct)}`}
                role="cell"
              >
                {row.isFirst ? "—" : `−${row.dropPct.toFixed(1)}%`}
              </span>
              <div className="bi-funnel__bar" role="cell">
                <div
                  className="bi-funnel__bar-fill"
                  style={{ width: `${Math.max(row.ofTotalPct, 2)}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
