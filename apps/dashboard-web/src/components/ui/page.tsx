import type { ReactNode } from "react"

export function PageHeader({ title, description, badge, actions }: { title: string; description: string; badge?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-7 flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
      <div><div className="mb-2 flex flex-wrap items-center gap-2"><h1 className="text-[clamp(1.5rem,2.2vw,2rem)] font-bold tracking-tight">{title}</h1>{badge}</div><p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">{description}</p></div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  )
}

export function SectionTitle({ title, detail, action }: { title: string; detail?: string; action?: ReactNode }) {
  return <div className="mb-4 flex items-center justify-between gap-4"><div><h2 className="text-sm font-bold tracking-tight">{title}</h2>{detail && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>}</div>{action}</div>
}

export function EmptyState({ title, detail, icon }: { title: string; detail: string; icon: ReactNode }) {
  return <div className="panel flex min-h-64 flex-col items-center justify-center p-8 text-center"><div className="mb-4 rounded-2xl border bg-muted p-4 text-muted-foreground">{icon}</div><h3 className="font-semibold">{title}</h3><p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{detail}</p></div>
}
