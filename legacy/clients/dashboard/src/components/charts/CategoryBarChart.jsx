import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ChartTooltip } from "./ChartTooltip.jsx";
import { AXIS_TICK, CHART_COLORS, GRID_STROKE, formatMoneyShort } from "./chartTheme.js";

/** Horizontal category bars — revenue / ranking style */
export function CategoryBarChart({
  data,
  dataKey = "revenue",
  nameKey = "name",
  height = 220,
  formatValue = formatMoneyShort,
}) {
  if (!data?.length) return null;

  const chartHeight = Math.max(height, data.length * 36 + 24);

  return (
    <div className="chart-frame chart-frame--compact chart-frame--category">
      <ResponsiveContainer width="100%" height={chartHeight}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 28, left: 4, bottom: 4 }}
          barCategoryGap="20%"
        >
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="4 6" horizontal={false} />
          <XAxis
            type="number"
            domain={[0, "auto"]}
            tick={{ ...AXIS_TICK, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatValue}
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
            content={<ChartTooltip valueFormatter={(v) => formatValue(v)} />}
            cursor={{ fill: "rgba(245, 78, 0, 0.06)" }}
          />
          <Bar
            dataKey={dataKey}
            radius={[0, 8, 8, 0]}
            barSize={22}
            maxBarSize={28}
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
