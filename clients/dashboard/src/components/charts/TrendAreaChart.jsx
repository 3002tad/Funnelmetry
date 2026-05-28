import {
  Area, AreaChart, CartesianGrid, Legend, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ChartGradients } from "./ChartGradients.jsx";
import { ChartTooltip } from "./ChartTooltip.jsx";
import {
  AXIS_TICK, CHART_MARGIN, GRID_STROKE, LEGEND_STYLE, formatCompact,
} from "./chartTheme.js";

/**
 * Multi-series area trend — gradients, active dots, optional peak marker.
 */
export function TrendAreaChart({
  data,
  series,
  height = 300,
  xKey = "time",
  peakKey,
  formatY = formatCompact,
  formatTooltipValue,
}) {
  if (!data?.length || !series?.length) return null;

  const gradients = series.map((s) => ({
    id: s.gradientId,
    color: s.stroke,
  }));

  let peakPoint = null;
  if (peakKey) {
    peakPoint = data.reduce(
      (max, row) => (Number(row[peakKey]) > Number(max[peakKey]) ? row : max),
      data[0]
    );
  }

  const peakSeries = series.find((s) => s.dataKey === peakKey) || series[0];

  return (
    <div className="chart-frame">
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={CHART_MARGIN}>
          <ChartGradients items={gradients} />
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="4 6" vertical={false} />
          <XAxis
            dataKey={xKey}
            tick={AXIS_TICK}
            axisLine={false}
            tickLine={false}
            dy={6}
          />
          <YAxis
            tick={{ ...AXIS_TICK, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={formatY}
          />
          <Tooltip
            content={
              <ChartTooltip valueFormatter={formatTooltipValue} />
            }
            cursor={{ stroke: "#c5cad8", strokeWidth: 1, strokeDasharray: "4 4" }}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={LEGEND_STYLE}
          />
          {series.map((s) => (
            <Area
              key={s.dataKey}
              type="monotone"
              dataKey={s.dataKey}
              name={s.name}
              stroke={s.stroke}
              fill={`url(#${s.gradientId})`}
              strokeWidth={2.5}
              dot={false}
              activeDot={{
                r: 5,
                strokeWidth: 2,
                stroke: "#fff",
                fill: s.stroke,
              }}
            />
          ))}
          {peakPoint && peakKey && (
            <ReferenceDot
              x={peakPoint[xKey]}
              y={peakPoint[peakKey]}
              r={6}
              fill={peakSeries.stroke}
              stroke="#fff"
              strokeWidth={2}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
