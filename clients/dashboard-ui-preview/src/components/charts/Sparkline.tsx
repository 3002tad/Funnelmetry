export function Sparkline({ data, positive }: { data: number[]; positive: boolean }) {
  const max = Math.max(...data), min = Math.min(...data), span = max - min || 1
  const points = data.map((value, index) => `${(index / (data.length - 1)) * 78},${30 - ((value - min) / span) * 25}`).join(" ")
  return <svg viewBox="0 0 78 34" className="h-9 w-20" aria-hidden="true"><polyline points={points} fill="none" stroke={positive ? "#34d399" : "#fb7185"} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
}
