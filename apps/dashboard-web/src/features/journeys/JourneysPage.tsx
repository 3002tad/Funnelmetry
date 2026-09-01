import { useEffect, useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { Activity, CalendarDays, CircleOff, Clock3, DatabaseZap, Network, RefreshCw, Search, ShieldCheck } from "lucide-react"
import { useOutletContext } from "react-router-dom"
import type { ShellContext } from "../../app/AppShell"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { EmptyState, PageHeader } from "../../components/ui/page"
import { fetchV2Journey, fetchV2Journeys, type OutcomeStatus, type QualityStatus } from "../../lib/analytics-api"

function formatDate(value: string | null | undefined) {
  if (!value) return "—"
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
}

function formatSpan(first: string, last: string) {
  const milliseconds = Math.max(0, new Date(last).getTime() - new Date(first).getTime())
  const minutes = Math.round(milliseconds / 60_000)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} hr`
  return `${Math.round(hours / 24)} days`
}

function outcomeTone(status: OutcomeStatus) {
  if (status === "CONVERTED") return "success" as const
  if (status === "INVALID") return "danger" as const
  if (status === "IN_PROGRESS") return "primary" as const
  return "warning" as const
}

function qualityTone(status: QualityStatus) {
  if (status === "RECONCILED") return "success" as const
  if (status === "DEGRADED") return "danger" as const
  return "warning" as const
}

export function JourneysPage() {
  const { sourceId } = useOutletContext<ShellContext>()
  const [query, setQuery] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const journeys = useQuery({ queryKey: ["v2-journeys", sourceId], queryFn: () => fetchV2Journeys(100) })
  const detail = useQuery({ queryKey: ["v2-journey", sourceId, selectedId], queryFn: () => fetchV2Journey(selectedId!), enabled: Boolean(selectedId) })

  useEffect(() => {
    if (!selectedId && journeys.data?.[0]) setSelectedId(journeys.data[0].journey_id)
  }, [journeys.data, selectedId])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return (journeys.data ?? []).filter((journey) => journey.journey_id.toLowerCase().includes(needle))
  }, [journeys.data, query])

  if (journeys.isLoading) return <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]"><div className="skeleton h-[680px]" /><div className="skeleton h-[680px]" /></div>
  if (journeys.isError) return <EmptyState icon={<CircleOff size={20} />} title="Cannot load journeys" detail="Check the Dashboard API, V2 migrations, analytics source ID, and your login session." />
  if (!journeys.data?.length) return <EmptyState icon={<Network size={20} />} title="No journeys yet" detail="Run the journey processor for the configured source, then refresh this page." />

  return <>
    <PageHeader title="Journey explorer" description="Canonical events linked into cross-session journeys, with explicit identity evidence and projection quality." badge={<Badge tone="primary">Cross-session</Badge>} actions={<Button variant="outline" onClick={() => journeys.refetch()}><RefreshCw size={14} /> Refresh</Button>} />
    <div className="mb-4 flex flex-wrap gap-2 text-xs"><Badge>{sourceId}</Badge><Badge tone="primary">Canonical metadata only</Badge><Badge>Entity keys hidden</Badge></div>
    <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
      <aside className="panel overflow-hidden">
        <div className="border-b p-4"><div className="relative"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search journey ID" className="h-9 w-full rounded-lg border bg-background pl-9 pr-3 text-xs" /></div></div>
        <div className="max-h-[720px] overflow-y-auto p-2">{visible.map((journey) => {
          const instance = journey.funnel_instances[0]
          return <button key={journey.journey_id} onClick={() => setSelectedId(journey.journey_id)} className={`mb-1 w-full rounded-lg border p-3 text-left transition ${selectedId === journey.journey_id ? "border-primary/40 bg-primary/10" : "border-transparent hover:bg-muted"}`}>
            <div className="flex items-start justify-between gap-2"><strong className="break-all font-mono text-xs">{journey.journey_id}</strong>{instance && <Badge tone={outcomeTone(instance.outcome_status)}>{instance.outcome_status}</Badge>}</div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-muted-foreground"><span>{journey.event_count} events</span><span>{formatSpan(journey.first_event_at, journey.last_event_at)}</span><span>{journey.entity_type_count} entity types</span></div>
          </button>
        })}</div>
      </aside>

      <section className="panel min-h-[680px] p-5 md:p-6">
        {detail.isLoading && <div className="space-y-4"><div className="skeleton h-20" /><div className="skeleton h-56" /><div className="skeleton h-40" /></div>}
        {detail.isError && <EmptyState icon={<CircleOff size={20} />} title="Cannot load journey detail" detail="The journey may have changed. Refresh the list and try again." />}
        {detail.data && <>
          <div className="flex flex-col justify-between gap-5 border-b pb-5 md:flex-row md:items-start">
            <div><p className="eyebrow">Journey</p><h2 className="mt-2 break-all font-mono text-xl font-semibold">{detail.data.journey_id}</h2><div className="mt-3 flex flex-wrap gap-2"><Badge tone="primary" dot>{detail.data.status}</Badge><Badge>{detail.data.evidence_summary.length} evidence groups</Badge><Badge>{detail.data.funnel_instances.length} funnel instances</Badge></div></div>
            <div className="grid grid-cols-2 gap-6 text-center"><div><strong className="block text-xl">{detail.data.event_count}</strong><span className="text-[10px] text-muted-foreground">Events</span></div><div><strong className="block text-xl">{formatSpan(detail.data.first_event_at, detail.data.last_event_at)}</strong><span className="text-[10px] text-muted-foreground">Journey span</span></div></div>
          </div>

          <div className="mt-6"><div className="mb-4 flex items-center gap-2"><Activity size={15} className="text-primary" /><h3 className="text-sm font-semibold">Canonical event timeline</h3></div>
            <div className="relative ml-2 border-l pl-6">{detail.data.events.map((event) => <article key={event.canonical_event_id} className="relative mb-5 last:mb-0"><span className="absolute -left-[29px] top-1 h-2.5 w-2.5 rounded-full bg-primary ring-4 ring-card" /><div className="rounded-lg border bg-muted/20 p-3"><div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center"><div><strong className="font-mono text-xs">{event.event_type}</strong><span className="ml-2 text-[10px] uppercase tracking-wide text-muted-foreground">{event.event_class}</span></div><span className="text-[10px] text-muted-foreground">{formatDate(event.occurred_at)}</span></div><div className="mt-2 flex flex-wrap gap-2"><Badge>{event.link_method}</Badge><Badge tone={event.link_confidence === "HIGH" ? "success" : "warning"}>{event.link_confidence} confidence</Badge>{event.quality?.time_basis && <Badge>{event.quality.time_basis}</Badge>}</div></div></article>)}</div>
          </div>

          <div className="mt-7 grid gap-4 border-t pt-5 lg:grid-cols-2">
            <section><div className="mb-3 flex items-center gap-2"><ShieldCheck size={15} className="text-primary" /><h3 className="text-sm font-semibold">Identity evidence</h3></div><div className="space-y-2">{detail.data.evidence_summary.length ? detail.data.evidence_summary.map((evidence) => <div key={`${evidence.entity_type}:${evidence.link_method}:${evidence.link_confidence}`} className="flex items-center justify-between rounded-lg bg-muted/40 p-3 text-xs"><div><strong>{evidence.entity_type}</strong><span className="ml-2 text-muted-foreground">{evidence.link_method}</span></div><Badge tone={evidence.link_confidence === "HIGH" ? "success" : "warning"}>{evidence.evidence_count} · {evidence.link_confidence}</Badge></div>) : <p className="text-xs text-muted-foreground">No identity evidence summary.</p>}</div></section>
            <section><div className="mb-3 flex items-center gap-2"><DatabaseZap size={15} className="text-primary" /><h3 className="text-sm font-semibold">Funnel instances</h3></div><div className="space-y-2">{detail.data.funnel_instances.length ? detail.data.funnel_instances.map((instance) => <div key={instance.funnel_instance_id} className="rounded-lg border p-3"><div className="flex flex-wrap items-center justify-between gap-2"><div><strong className="text-xs">{instance.funnel_profile_id}</strong><span className="ml-2 font-mono text-[10px] text-muted-foreground">{instance.profile_version}</span></div><div className="flex gap-1"><Badge tone={outcomeTone(instance.outcome_status)}>{instance.outcome_status}</Badge><Badge tone={qualityTone(instance.quality_status)}>{instance.quality_status}</Badge></div></div><div className="mt-3 flex flex-wrap gap-2">{instance.steps.map((step) => <Badge key={`${instance.funnel_instance_id}:${step.step_index}`} tone={step.sequence_status === "IN_ORDER" ? "success" : "warning"}>{step.step_index + 1}. {step.event_type}</Badge>)}</div></div>) : <p className="text-xs text-muted-foreground">This journey has not entered an active funnel profile.</p>}</div></section>
          </div>

          <div className="mt-5 grid gap-3 border-t pt-5 sm:grid-cols-2"><div className="rounded-lg bg-muted/40 p-3"><CalendarDays size={15} className="mb-2 text-primary" /><span className="block text-[10px] text-muted-foreground">First event</span><strong className="text-xs">{formatDate(detail.data.first_event_at)}</strong></div><div className="rounded-lg bg-muted/40 p-3"><Clock3 size={15} className="mb-2 text-primary" /><span className="block text-[10px] text-muted-foreground">Last event</span><strong className="text-xs">{formatDate(detail.data.last_event_at)}</strong></div></div>
        </>}
      </section>
    </div>
  </>
}
