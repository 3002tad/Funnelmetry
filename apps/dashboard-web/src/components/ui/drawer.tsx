import { useEffect, useId, useRef, type ReactNode } from "react"
import { X } from "lucide-react"

export function Drawer({ open, onClose, title, subtitle, children }: { open: boolean; onClose: () => void; title: string; subtitle?: string; children: ReactNode }) {
  const titleId = useId()
  const panel = useRef<HTMLElement>(null)
  const close = useRef<HTMLButtonElement>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  useEffect(() => {
    if (!open) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    close.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onCloseRef.current(); return }
      if (event.key !== "Tab" || !panel.current) return
      const focusables = Array.from(panel.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])'))
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => { document.body.style.overflow = previousOverflow; document.removeEventListener("keydown", onKeyDown); previousFocus?.focus() }
  }, [open])

  if (!open) return null
  return <div className="drawer-overlay" onMouseDown={onClose}>
    <aside ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} className="drawer-panel" onMouseDown={event => event.stopPropagation()}>
      <div className="mb-6 flex items-start justify-between gap-4 border-b pb-5">
        <div className="min-w-0"><p className="eyebrow mb-2">Inspector</p><h2 id={titleId} className="break-words text-xl font-bold tracking-tight">{title}</h2>{subtitle && <p className="mt-1 break-all text-xs text-muted-foreground">{subtitle}</p>}</div>
        <button ref={close} type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onClose} aria-label="Đóng chi tiết"><X size={18} /></button>
      </div>
      {children}
    </aside>
  </div>
}
