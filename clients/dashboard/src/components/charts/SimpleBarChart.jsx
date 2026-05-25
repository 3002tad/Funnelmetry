import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { CHART_COLORS, GRID_STROKE, TICK_FILL, TOOLTIP_STYLE } from "./chartTheme.js";

/** Horizontal bar chart */
export function BarChartH({ data, dataKey = "value", nameKey = "name", height = 260, color }) {
  if (!data?.length) return null;

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ left: 4, right: 20, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 11, fill: TICK_FILL }} />
        <YAxis type="category" dataKey={nameKey} width={100} tick={{ fontSize: 11, fill: TICK_FILL }} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Bar dataKey={dataKey} fill={color || CHART_COLORS[0]} radius={[0, 6, 6, 0]} barSize={20} />
      </BarChart>
    </ResponsiveContainer>
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

  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={GRID_STROKE} vertical={false} />
        <XAxis dataKey={xKey} tick={{ fontSize: 10, fill: TICK_FILL }} />
        <YAxis tick={{ fontSize: 11, fill: TICK_FILL }} />
        <Tooltip contentStyle={TOOLTIP_STYLE} />
        <Legend wrapperStyle={{ fontSize: "0.75rem" }} />
        {keys.map((k, i) => (
          <Bar key={k.key} dataKey={k.key} name={k.label} fill={CHART_COLORS[i % CHART_COLORS.length]} radius={[4, 4, 0, 0]} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
