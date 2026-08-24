import { useState } from "react";
import { Cell, Pie, PieChart, ResponsiveContainer, Sector, Tooltip } from "recharts";
import { CHART_COLORS } from "./chartTheme.js";
import { ChartTooltip } from "./ChartTooltip.jsx";

function ActiveSlice(props) {
  const { cx, cy, innerRadius, outerRadius, startAngle, endAngle, fill } = props;
  return (
    <Sector
      cx={cx}
      cy={cy}
      innerRadius={innerRadius}
      outerRadius={outerRadius + 6}
      startAngle={startAngle}
      endAngle={endAngle}
      fill={fill}
      stroke="#fff"
      strokeWidth={2}
    />
  );
}

export function DonutBreakdown({ data, height = 240, centerLabel, centerSub = "Tổng" }) {
  const [activeIndex, setActiveIndex] = useState(undefined);

  if (!data?.length) return null;

  const total = data.reduce((s, d) => s + d.value, 0);

  return (
    <div className="donut-wrap donut-wrap--pro">
      <div className="donut-wrap__chart">
        <ResponsiveContainer width="100%" height={height}>
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius="62%"
              outerRadius="88%"
              paddingAngle={3}
              cornerRadius={4}
              dataKey="value"
              nameKey="name"
              activeIndex={activeIndex}
              activeShape={ActiveSlice}
              onMouseEnter={(_, i) => setActiveIndex(i)}
              onMouseLeave={() => setActiveIndex(undefined)}
              stroke="#fff"
              strokeWidth={2}
            >
              {data.map((_, i) => (
                <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              content={
                <ChartTooltip
                  valueFormatter={(v, name) => {
                    const pct = total > 0 ? ((v / total) * 100).toFixed(1) : "0";
                    return `${Number(v).toLocaleString("vi-VN")} (${pct}%)`;
                  }}
                />
              }
            />
          </PieChart>
        </ResponsiveContainer>
        {centerLabel != null && (
          <div className="donut-center">
            <span className="donut-center__value">{centerLabel}</span>
            <span className="donut-center__label">{centerSub}</span>
          </div>
        )}
      </div>
      <ul className="donut-legend donut-legend--pro">
        {data.map((d, i) => {
          const pct = total > 0 ? (d.value / total) * 100 : 0;
          const color = CHART_COLORS[i % CHART_COLORS.length];
          return (
            <li key={d.name}>
              <span className="donut-legend__dot" style={{ background: color }} />
              <div className="donut-legend__meta">
                <span className="donut-legend__name">{d.name}</span>
                <div className="donut-legend__bar">
                  <div
                    className="donut-legend__bar-fill"
                    style={{ width: `${pct}%`, background: color }}
                  />
                </div>
              </div>
              <strong>{pct.toFixed(0)}%</strong>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
