import { X } from "lucide-react"
import type { ReactNode } from "react"
import { Button } from "./button"

export function Drawer({ open, onClose, title, subtitle, children }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode }) {
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-[2px]" onMouseDown={onClose}>
      <aside className="h-full w-full max-w-[470px] overflow-y-auto border-l bg-card p-6 shadow-panel" onMouseDown={(event) => event.stopPropagation()}>
        <div className="mb-6 flex items-start justify-between gap-4">
          <div><p className="eyebrow mb-2">Inspector</p><h2 className="text-xl font-semibold">{title}</h2>{subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}</div>
          <Button variant="ghost" size="icon" onClick={onClose}><X size={18} /></Button>
        </div>
        {children}
      </aside>
    </div>
  )
}
