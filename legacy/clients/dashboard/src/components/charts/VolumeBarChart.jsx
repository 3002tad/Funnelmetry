import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ChartTooltip } from "./ChartTooltip.jsx";
import {
  AXIS_TICK, CHART_COLORS, CHART_MARGIN, GRID_STROKE, formatCompact,
} from "./chartTheme.js";

/** Vertical bars — volume compare on Overview */
export function VolumeBarChart({
  data,
  dataKey = "value",
  nameKey = "name",
  height = 260,
  formatValue = formatCompact,
}) {
  if (!data?.length) return null;

  return (
    <div className="chart-frame">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ ...CHART_MARGIN, bottom: 8 }}>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="4 6" vertical={false} />
          <XAxis
            dataKey={nameKey}
            tick={{ ...AXIS_TICK, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            interval={0}
            angle={-14}
            textAnchor="end"
            height={54}
          />
          <YAxis
            tick={{ ...AXIS_TICK, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={formatValue}
            domain={[0, "auto"]}
          />
          <Tooltip
            content={<ChartTooltip valueFormatter={(v) => formatValue(v)} />}
            cursor={{ fill: "rgba(83, 56, 158, 0.06)", radius: 6 }}
          />
          <Bar
            dataKey={dataKey}
            radius={[8, 8, 0, 0]}
            barSize={32}
            maxBarSize={48}
            isAnimationActive={false}
          >
            {data.map((row, i) => (
              <Cell
                key={row[nameKey] ?? i}
                fill={CHART_COLORS[i % CHART_COLORS.length]}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
