import { useState, type ReactNode } from "react"

export function ProgressiveDetails({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return <details className="panel mt-5 overflow-hidden" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className="cursor-pointer px-5 py-4 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{label}</summary>
    {open && <div className="border-t p-5">{children}</div>}
  </details>
}
