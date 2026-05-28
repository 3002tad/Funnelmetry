import {
  Bar, BarChart, CartesianGrid, Cell, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ChartGradients } from "./ChartGradients.jsx";
import { ChartTooltip } from "./ChartTooltip.jsx";
import {
  AXIS_TICK, CHART_COLORS, CHART_MARGIN, GRID_STROKE, formatCompact,
} from "./chartTheme.js";

/** Horizontal bar chart */
export function BarChartH({ data, dataKey = "value", nameKey = "name", height = 260, color }) {
  if (!data?.length) return null;

  const barColor = color || CHART_COLORS[0];
  const gradients = [{ id: "hBar0", color: barColor }];

  return (
    <div className="chart-frame chart-frame--compact">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ left: 4, right: 24, top: 8, bottom: 4 }}>
          <ChartGradients items={gradients} />
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="4 6" horizontal={false} />
          <XAxis
            type="number"
            tick={{ ...AXIS_TICK, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatCompact}
          />
          <YAxis
            type="category"
            dataKey={nameKey}
            width={108}
            tick={{ ...AXIS_TICK, fontSize: 11, fill: "#4b5563" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={<ChartTooltip valueFormatter={(v) => formatCompact(v)} />}
            cursor={{ fill: "rgba(83, 56, 158, 0.06)" }}
          />
          <Bar dataKey={dataKey} fill="url(#hBar0Bar)" radius={[0, 8, 8, 0]} barSize={22} maxBarSize={28} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Vertical grouped bars */
export function BarChartGrouped({
  data,
  keys,
  height = 240,
  xKey = "name",
}) {
  if (!data?.length) return null;

  const gradients = keys.map((k, i) => ({
    id: `grp${i}`,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));

  return (
    <div className="chart-frame">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={CHART_MARGIN}>
          <ChartGradients items={gradients} />
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="4 6" vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={{ ...AXIS_TICK, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ ...AXIS_TICK, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={formatCompact}
          />
          <Tooltip content={<ChartTooltip valueFormatter={(v) => formatCompact(v)} />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "0.75rem", paddingTop: 8 }} />
          {keys.map((k, i) => (
            <Bar
              key={k.key}
              dataKey={k.key}
              name={k.label}
              fill={`url(#grp${i}Bar)`}
              radius={[6, 6, 0, 0]}
              barSize={18}
              maxBarSize={24}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
