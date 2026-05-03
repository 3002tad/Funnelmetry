export default function LatencyBar({
  label,
  value,
  color,
  max,
}: {
  label: string;
  value: number | null;
  color: string;
  max: number;
}) {
  const pct = value != null && max > 0 ? Math.max(5, (value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-3">
      <div className="w-36 text-xs text-slate-400 text-right">{label}</div>
      <div className="flex-1 bg-slate-800/60 ring-1 ring-slate-700/40 rounded-full h-5 overflow-hidden">
        <div
          className={`${color} h-full rounded-full transition-all duration-500 flex items-center justify-end pr-2`}
          style={{ width: `${pct}%` }}
        >
          {value != null && <span className="text-[10px] text-white font-medium">{value}ms</span>}
        </div>
      </div>
    </div>
  );
}
