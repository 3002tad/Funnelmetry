import {
  Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ChartGradients } from "./ChartGradients.jsx";
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

  const gradients = data.map((_, i) => ({
    id: `catBar${i}`,
    color: CHART_COLORS[i % CHART_COLORS.length],
  }));

  return (
    <div className="chart-frame chart-frame--compact">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 28, left: 4, bottom: 4 }}
        >
          <ChartGradients items={gradients} />
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="4 6" horizontal={false} />
          <XAxis
            type="number"
            tick={{ ...AXIS_TICK, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatValue}
          />
          <YAxis
            type="category"
            dataKey={nameKey}
            width={96}
            tick={{ ...AXIS_TICK, fontSize: 11, fill: "#4b5563" }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            content={<ChartTooltip valueFormatter={(v) => formatValue(v)} />}
            cursor={{ fill: "rgba(245, 78, 0, 0.06)" }}
          />
          <Bar dataKey={dataKey} radius={[0, 8, 8, 0]} barSize={20} maxBarSize={28}>
            {data.map((_, i) => (
              <Cell key={i} fill={`url(#catBar${i}Bar)`} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
