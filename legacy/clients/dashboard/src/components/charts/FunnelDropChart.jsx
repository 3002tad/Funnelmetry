import {
  Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { ChartTooltip } from "./ChartTooltip.jsx";
import { AXIS_TICK, GRID_STROKE, formatCompact } from "./chartTheme.js";
import { buildFunnelRows, funnelDropSeries } from "../../lib/funnelMetrics.js";

/**
 * Waterfall-style: users lost between funnel steps (BI diagnostic chart).
 */
export function FunnelDropChart({ steps, labels = {}, height = 260 }) {
  const { rows } = buildFunnelRows(steps, labels);
  const data = funnelDropSeries(rows);
  if (!data.length) return null;

  return (
    <div className="chart-frame chart-frame--compact">
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 8, right: 16, left: 4, bottom: 48 }}>
          <CartesianGrid stroke={GRID_STROKE} strokeDasharray="4 6" vertical={false} />
          <XAxis
            dataKey="name"
            tick={{ ...AXIS_TICK, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            interval={0}
            angle={-18}
            textAnchor="end"
            height={56}
          />
          <YAxis
            tick={{ ...AXIS_TICK, fontSize: 10 }}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={formatCompact}
          />
          <Tooltip
            content={
              <ChartTooltip
                valueFormatter={(v, name) => {
                  if (name === "Người rời bỏ") return formatCompact(v);
                  return formatCompact(v);
                }}
              />
            }
            cursor={{ fill: "rgba(185, 28, 28, 0.06)" }}
          />
          <Bar
            dataKey="lost"
            name="Người rời bỏ"
            fill="#dc2626"
            radius={[6, 6, 0, 0]}
            barSize={36}
            maxBarSize={48}
          />
        </BarChart>
      </ResponsiveContainer>
      <p className="chart-caption">Số người không chuyển sang bước kế tiếp</p>
    </div>
  );
}
