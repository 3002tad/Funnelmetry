import {
  Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ChartTooltip } from "./ChartTooltip.jsx";
import {
  AXIS_TICK, CHART_COLORS, CHART_MARGIN, GRID_STROKE, formatCompact,
} from "./chartTheme.js";

function truncateLabel(value, max = 26) {
  const s = String(value ?? "");
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Horizontal bar chart */
export function BarChartH({ data, dataKey = "value", nameKey = "name", height = 260, color }) {
  if (!data?.length) return null;

  const barColor = color || CHART_COLORS[0];
  const yAxisWidth = 148;
  const chartMargin = { left: 8, right: 20, top: 8, bottom: 4 };

  return (
    <div className="chart-frame chart-frame--compact chart-frame--bar-h">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={data}
          layout="vertical"
          margin={chartMargin}
          barCategoryGap="18%"
        >
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
            width={yAxisWidth}
            tick={{ ...AXIS_TICK, fontSize: 10, fill: "#374151" }}
            axisLine={false}
            tickLine={false}
            tickFormatter={(v) => truncateLabel(v)}
          />
          <Tooltip
            content={
              <ChartTooltip
                labelFormatter={(label) => String(label)}
                valueFormatter={(v) => formatCompact(v)}
              />
            }
            cursor={{ fill: "rgba(83, 56, 158, 0.06)" }}
          />
          <Bar
            dataKey={dataKey}
            fill={barColor}
            stroke={barColor}
            strokeWidth={0}
            radius={[0, 8, 8, 0]}
            barSize={20}
            maxBarSize={26}
            isAnimationActive={false}
          />
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

  return (
    <div className="chart-frame">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={CHART_MARGIN}>
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
            domain={[0, "auto"]}
          />
          <Tooltip content={<ChartTooltip valueFormatter={(v) => formatCompact(v)} />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "0.75rem", paddingTop: 8 }} />
          {keys.map((k, i) => (
            <Bar
              key={k.key}
              dataKey={k.key}
              name={k.label}
              fill={CHART_COLORS[i % CHART_COLORS.length]}
              radius={[6, 6, 0, 0]}
              barSize={18}
              maxBarSize={24}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
