import type { ReactNode } from "react"
import { cn } from "../../lib/utils"

type Tone = "neutral" | "primary" | "success" | "warning" | "danger" | "commerce" | "behavior"
const tones: Record<Tone, string> = {
  neutral: "border-border bg-muted text-muted-foreground",
  primary: "border-primary/25 bg-primary/10 text-primary",
  success: "border-success/25 bg-success/10 text-success",
  warning: "border-warning/25 bg-warning/10 text-warning",
  danger: "border-destructive/25 bg-destructive/10 text-destructive",
  commerce: "border-emerald-500/25 bg-emerald-500/10 text-emerald-400",
  behavior: "border-sky-500/25 bg-sky-500/10 text-sky-400",
}

export function Badge({ children, tone = "neutral", dot, className }: { children: ReactNode; tone?: Tone; dot?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-[11px] font-medium", tones[tone], className)}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" />}{children}
    </span>
  )
}
