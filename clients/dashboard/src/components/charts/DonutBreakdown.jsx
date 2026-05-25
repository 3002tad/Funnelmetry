import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { CHART_COLORS, TOOLTIP_STYLE } from "./chartTheme.js";

export function DonutBreakdown({ data, height = 220, centerLabel }) {
  if (!data?.length) return null;

  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="donut-wrap">
      <ResponsiveContainer width="100%" height={height}>
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius="58%"
            outerRadius="82%"
            paddingAngle={2}
            dataKey="value"
            nameKey="name"
          >
            {data.map((_, i) => (
              <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Pie>
          <Tooltip
            formatter={(v, name) => [
              `${Number(v).toLocaleString()} (${total > 0 ? ((v / total) * 100).toFixed(1) : 0}%)`,
              name,
            ]}
            contentStyle={TOOLTIP_STYLE}
          />
        </PieChart>
      </ResponsiveContainer>
      {centerLabel && (
        <div className="donut-center">
          <span className="donut-center__value">{centerLabel}</span>
          <span className="donut-center__label">Tổng</span>
        </div>
      )}
      <ul className="donut-legend">
        {data.map((d, i) => (
          <li key={d.name}>
            <span className="donut-legend__dot" style={{ background: CHART_COLORS[i % CHART_COLORS.length] }} />
            <span>{d.name}</span>
            <strong>{total > 0 ? `${((d.value / total) * 100).toFixed(0)}%` : "0%"}</strong>
          </li>
        ))}
      </ul>
    </div>
  );
}
