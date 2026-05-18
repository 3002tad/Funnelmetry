import { ReactNode } from 'react'
import { BarChart3 } from 'lucide-react'

interface EmptyChartProps {
  icon?: ReactNode;
  message?: string;
  hint?: string;
  height?: number;
}

export default function EmptyChart({
  icon = <BarChart3 size={32} className="text-slate-700" />,
  message = "No data yet",
  hint = "Generate events at port 5174 to see live data",
  height = 300,
}: EmptyChartProps) {
  return (
    <div
      style={{ height }}
      className="flex flex-col items-center justify-center gap-2 text-center"
    >
      <div className="w-14 h-14 rounded-full bg-slate-800/50 ring-1 ring-slate-700/40 flex items-center justify-center mb-1">
        {icon}
      </div>
      <p className="text-sm font-medium text-slate-400">{message}</p>
      <p className="text-xs text-slate-600">{hint}</p>
    </div>
  )
}
