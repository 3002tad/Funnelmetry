import { useState } from "react"
import { ArrowLeft, CheckCircle2, Circle, Clock3, Database, MonitorSmartphone } from "lucide-react"
import { Link, useParams } from "react-router-dom"
import { Badge } from "../../components/ui/badge"
import { Drawer } from "../../components/ui/drawer"
import { PageHeader } from "../../components/ui/page"

const timeline = [
  { name: "session.started", time: "10:08:11.042", kind: "Behavior", source: "web-sdk" },
  { name: "behavior.product_viewed", time: "10:08:34.128", kind: "Behavior", source: "web-sdk" },
  { name: "cart.item_added", time: "10:10:08.554", kind: "Commerce", source: "medusa-webhook" },
  { name: "checkout.started", time: "10:12:42.091", kind: "Behavior", source: "web-sdk" },
  { name: "payment.attempted", time: "10:14:10.772", kind: "Commerce", source: "medusa-subscriber" },
  { name: "payment.failed", time: "10:14:13.012", kind: "Commerce", source: "medusa-subscriber" },
  { name: "payment.captured", time: "10:15:44.331", kind: "Commerce", source: "medusa-subscriber" },
  { name: "order.accepted", time: "10:15:48.904", kind: "Commerce", source: "medusa-subscriber" },
] as const

export function SessionPage() {
  const { sessionId = "ses_8A21" } = useParams()
  const [selected, setSelected] = useState<(typeof timeline)[number] | null>(null)
  return <>
    <Link to="/journeys" className="mb-4 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft size={14} /> Back to journeys</Link>
    <PageHeader title="Session detail" description="An event timeline for one session. This is not a video or DOM replay." badge={<Badge tone="success">Converted</Badge>} />
    <div className="panel mb-4 grid gap-4 p-5 sm:grid-cols-3 xl:grid-cols-6">{[["Session ID",sessionId],["Journey ID","journey_10021"],["Duration","7m 38s"],["Source","Direct"],["Device","Desktop"],["Events","8"]].map(([label,value]) => <div key={label}><span className="text-[10px] text-muted-foreground">{label}</span><strong className={`mt-1 block text-xs ${label.includes("ID") ? "font-mono" : ""}`}>{value}</strong></div>)}</div>
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]"><section className="panel p-5"><div className="mb-6"><h2 className="text-sm font-semibold">Event timeline</h2><p className="mt-1 text-xs text-muted-foreground">Click an event to inspect its canonical payload</p></div><div className="relative ml-3 border-l pl-7">{timeline.map((event, index) => <button key={event.name} onClick={() => setSelected(event)} className="group relative mb-3 w-full rounded-lg border bg-muted/20 p-3 text-left hover:border-primary/40 hover:bg-muted/40"><span className={`absolute -left-[36px] top-4 h-4 w-4 rounded-full border-4 border-card ${event.kind === "Commerce" ? "bg-emerald-400" : "bg-sky-400"}`} /><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center"><div className="flex items-center gap-3"><span className="font-mono text-xs">{event.name}</span><Badge tone={event.kind === "Commerce" ? "commerce" : "behavior"}>{event.kind}</Badge></div><span className="font-mono text-[10px] text-muted-foreground">{event.time}</span></div><div className="mt-2 flex gap-4 text-[10px] text-muted-foreground"><span>{event.source}</span><span>{event.kind === "Commerce" ? "Authoritative fact" : "Observed behavior"}</span>{index === timeline.length - 1 && <span className="text-success">Conversion anchor</span>}</div></button>)}</div></section>
      <aside className="space-y-4"><div className="panel p-4"><h3 className="text-xs font-medium">Event semantics</h3><div className="mt-4 space-y-3 text-xs"><div className="flex gap-3"><span className="mt-1 h-2 w-2 rounded-full bg-sky-400" /><div><strong>Behavioral event</strong><p className="mt-1 text-[10px] text-muted-foreground">Observed user intent from the browser.</p></div></div><div className="flex gap-3"><span className="mt-1 h-2 w-2 rounded-full bg-emerald-400" /><div><strong>Commerce fact</strong><p className="mt-1 text-[10px] text-muted-foreground">Authoritative outcome confirmed by source.</p></div></div></div></div><div className="panel p-4"><h3 className="text-xs font-medium">Session outcome</h3><div className="mt-4 space-y-3 text-xs"><div className="flex items-center gap-2 text-success"><CheckCircle2 size={15} /> Order accepted</div><div className="flex items-center gap-2 text-muted-foreground"><Clock3 size={15} /> Reconciled in 4.8s</div><div className="flex items-center gap-2 text-muted-foreground"><MonitorSmartphone size={15} /> Desktop · Chrome</div></div></div></aside></div>
    <Drawer open={!!selected} onClose={() => setSelected(null)} title={selected?.name ?? "Event"} subtitle={`${selected?.time} · ${selected?.source}`}><div className="grid grid-cols-2 gap-3">{[["Event type",selected?.kind],["Authority",selected?.kind === "Commerce" ? "Authoritative" : "Observed"],["Validation","Valid"],["Projection",selected?.kind === "Commerce" ? "Reconciled" : "Live / Provisional"]].map(([label,value]) => <div key={label} className="rounded-lg border p-3"><span className="text-[10px] text-muted-foreground">{label}</span><strong className="mt-1 block text-xs">{value}</strong></div>)}</div><div className="mt-6"><h3 className="mb-3 text-xs font-medium">Canonical properties</h3><pre className="scrollbar-thin overflow-auto rounded-lg border bg-background p-4 font-mono text-[11px] leading-6 text-muted-foreground">{JSON.stringify({ event_id: "evt_01J5F8A21", source_id: selected?.source, event_name: selected?.name, session_id: sessionId, journey_id: "journey_10021", occurred_at: `2026-08-21T${selected?.time}Z`, authority: selected?.kind === "Commerce" ? "authoritative" : "observed", payload: { product_id: "prod_401", currency: "USD", amount: selected?.name === "order.accepted" ? 189 : undefined } }, null, 2)}</pre></div><div className="mt-5 flex items-center gap-2 text-xs text-success"><Database size={14} /> Durable raw receipt confirmed</div></Drawer>
  </>
}
