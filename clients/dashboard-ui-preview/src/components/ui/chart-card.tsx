import type { ReactNode } from "react"
import { MoreHorizontal } from "lucide-react"
import { Button } from "./button"

export function ChartCard({ title, detail, children, className = "", action }: { title: string; detail?: string; children: ReactNode; className?: string; action?: ReactNode }) {
  return <section className={`panel p-4 md:p-5 ${className}`}><div className="mb-4 flex items-start justify-between gap-3"><div><h2 className="text-sm font-semibold">{title}</h2>{detail && <p className="mt-1 text-xs text-muted-foreground">{detail}</p>}</div>{action ?? <Button variant="ghost" size="icon"><MoreHorizontal size={16} /></Button>}</div>{children}</section>
}
