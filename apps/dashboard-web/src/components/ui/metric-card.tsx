import type { LucideIcon } from "lucide-react"
import { ArrowDownRight, ArrowUpRight } from "lucide-react"
import { Sparkline } from "../charts/Sparkline"

export function MetricCard({ label, value, change, icon: Icon, data, inverse = false }: { label: string; value: string; change: number; icon: LucideIcon; data: number[]; inverse?: boolean }) {
  const positive = inverse ? change <= 0 : change >= 0
  return (
    <article className="panel panel-hover p-4">
      <div className="flex items-center justify-between text-muted-foreground"><span className="text-xs font-medium">{label}</span><Icon size={16} /></div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <div><strong className="text-2xl font-semibold tracking-tight">{value}</strong><div className={`mt-2 flex items-center gap-1 text-xs ${positive ? "text-success" : "text-destructive"}`}>{change >= 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{Math.abs(change)}% <span className="text-muted-foreground">vs prior</span></div></div>
        <Sparkline data={data} positive={positive} />
      </div>
    </article>
  )
}
