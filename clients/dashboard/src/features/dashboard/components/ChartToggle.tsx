import { BarChart3, LineChart as LineChartIcon, AreaChart as AreaChartIcon } from "lucide-react";
import type { ChartType } from "../chartTheme";

export default function ChartToggle({
  value,
  onChange,
  options = ["area", "line", "bar"],
}: {
  value: ChartType;
  onChange: (v: ChartType) => void;
  options?: ChartType[];
}) {
  const icons: Record<ChartType, typeof BarChart3> = {
    area: AreaChartIcon,
    line: LineChartIcon,
    bar: BarChart3,
  };
  return (
    <div className="flex bg-slate-800/50 ring-1 ring-slate-700/50 rounded-md p-0.5 gap-0.5">
      {options.map((opt) => {
        const Icon = icons[opt];
        return (
          <button
            key={opt}
            onClick={() => onChange(opt)}
            className={`p-1.5 rounded transition-all ${
              value === opt
                ? "bg-gradient-to-br from-indigo-500/30 to-violet-500/30 text-indigo-200 ring-1 ring-indigo-400/40"
                : "text-slate-500 hover:text-slate-300"
            }`}
            title={opt.charAt(0).toUpperCase() + opt.slice(1)}
          >
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}
