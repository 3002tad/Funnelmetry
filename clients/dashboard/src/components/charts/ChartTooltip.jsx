/**
 * Custom Recharts tooltip — card style with colored series dots.
 */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormatter,
  valueFormatter,
}) {
  if (!active || !payload?.length) return null;

  const title = labelFormatter ? labelFormatter(label) : label;

  return (
    <div className="chart-tooltip" role="tooltip">
      {title != null && title !== "" && (
        <div className="chart-tooltip__label">{title}</div>
      )}
      <ul className="chart-tooltip__list">
        {payload
          .filter((e) => e.value != null && e.value !== "")
          .map((entry) => {
            const formatted = valueFormatter
              ? valueFormatter(entry.value, entry.name, entry)
              : Number(entry.value).toLocaleString("vi-VN");
            return (
              <li key={`${entry.dataKey}-${entry.name}`}>
                <span
                  className="chart-tooltip__dot"
                  style={{ background: entry.color || entry.stroke }}
                />
                <span className="chart-tooltip__name">{entry.name}</span>
                <strong>{formatted}</strong>
              </li>
            );
          })}
      </ul>
    </div>
  );
}
