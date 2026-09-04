import { useQuery } from "@tanstack/react-query"
import { Activity, AlertTriangle, CheckCircle2, CircleOff, Clock3, DatabaseZap, RefreshCw, ShieldAlert } from "lucide-react"
import { useOutletContext } from "react-router-dom"
import type { ShellContext } from "../../app/AppShell"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { ChartCard } from "../../components/ui/chart-card"
import { EmptyState, PageHeader } from "../../components/ui/page"
import { fetchV2DataHealth, type DataHealthResponse } from "../../lib/analytics-api"
import { compact } from "../../lib/utils"

function percent(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`
}

function duration(value: number | null) {
  if (value === null) return "—"
  if (value < 1000) return `${Math.round(value)} ms`
  return `${(value / 1000).toFixed(2)} s`
}

function HealthTimelineChart({ buckets }: { buckets: DataHealthResponse["hourly"] }) {
  if (!buckets.length) return <div className="grid h-[300px] place-items-center text-xs text-muted-foreground">No populated hourly buckets in this window.</div>
  const width = 800
  const height = 260
  const left = 42
  const right = 18
  const top = 18
  const bottom = 38
  const plotWidth = width - left - right
  const plotHeight = height - top - bottom
  const maximum = Math.max(1, ...buckets.flatMap((bucket) => [bucket.canonical_events, bucket.non_authoritative_time]))
  const point = (value: number, index: number) => {
    const x = left + (buckets.length === 1 ? plotWidth / 2 : index / (buckets.length - 1) * plotWidth)
    const y = top + plotHeight - value / maximum * plotHeight
    return { x, y }
  }
  const canonical = buckets.map((bucket, index) => point(bucket.canonical_events, index))
  const fallback = buckets.map((bucket, index) => point(bucket.non_authoritative_time, index))
  const points = (values: Array<{ x: number; y: number }>) => values.map(({ x, y }) => `${x},${y}`).join(" ")
  const labels = buckets.map((bucket, index) => ({ bucket, index })).filter(({ index }) => index === 0 || index === buckets.length - 1 || index % Math.max(1, Math.ceil(buckets.length / 5)) === 0)
  return <div><div className="mb-2 flex justify-end gap-4 text-[10px] text-muted-foreground"><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-primary" />Canonical persisted</span><span className="flex items-center gap-1.5"><i className="h-2 w-2 rounded-full bg-warning" />Non-authoritative time</span></div><svg viewBox={`0 0 ${width} ${height}`} className="h-[270px] w-full" role="img" aria-label="Canonical persistence by hour"><line x1={left} y1={top + plotHeight} x2={width - right} y2={top + plotHeight} stroke="currentColor" className="text-border" /><line x1={left} y1={top} x2={left} y2={top + plotHeight} stroke="currentColor" className="text-border" />{[0, .25, .5, .75, 1].map((ratio) => { const y = top + plotHeight - ratio * plotHeight; return <g key={ratio}><line x1={left} y1={y} x2={width-right} y2={y} stroke="currentColor" className="text-border" opacity=".45" /><text x={left-8} y={y+4} textAnchor="end" className="fill-muted-foreground text-[9px]">{Math.round(maximum * ratio)}</text></g> })}<polyline fill="none" stroke="#3b82f6" strokeWidth="3" strokeLinejoin="round" points={points(canonical)} /><polyline fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinejoin="round" points={points(fallback)} />{canonical.map(({ x, y }, index) => <circle key={`canonical-${index}`} cx={x} cy={y} r="3" fill="#3b82f6"><title>{`${buckets[index].bucket_start}: ${buckets[index].canonical_events} canonical events`}</title></circle>)}{labels.map(({ bucket, index }) => <text key={bucket.bucket_start} x={point(0, index).x} y={height-12} textAnchor="middle" className="fill-muted-foreground text-[9px]">{new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "2-digit" }).format(new Date(bucket.bucket_start))}</text>)}</svg></div>
}

export function DataHealthPage() {
  const { range, sourceId } = useOutletContext<ShellContext>()
  const health = useQuery({ queryKey: ["v2-data-health", sourceId, range], queryFn: () => fetchV2DataHealth(range) })
  if (health.isLoading) return <div className="space-y-4"><div className="skeleton h-16 w-96" /><div className="grid grid-cols-2 gap-3 xl:grid-cols-5">{[1,2,3,4,5].map((item) => <div key={item} className="skeleton h-28" />)}</div><div className="skeleton h-80" /></div>
  if (health.isError || !health.data) return <EmptyState icon={<CircleOff size={20} />} title="Cannot load Data Health V2" detail="Check Dashboard API, migrations 001–005, source ID and your login session." />

  const data = health.data
  const attention = data.canonical.ingress_fallback_time > 0
    || data.projection_quality.degraded > 0
    || data.reconciliation.quality_gate.state !== "RECONCILED"
    || data.canonicalization.unsupported > 0
    || data.canonicalization.quarantined > 0
    || (data.canonicalization.terminal_outcome_rate !== null && data.canonicalization.terminal_outcome_rate < 1)
  const cards = [
    { label: "Accepted raw", value: compact.format(data.canonicalization.accepted_events), detail: "Unique durable ingress receipts", icon: DatabaseZap },
    { label: "Terminal outcomes", value: percent(data.canonicalization.terminal_outcome_rate), detail: `${compact.format(data.canonicalization.terminal_outcomes)} accepted events resolved`, icon: Clock3 },
    { label: "Non-normalized", value: compact.format(data.canonicalization.unsupported + data.canonicalization.quarantined), detail: `${compact.format(data.canonicalization.quarantined)} quarantined`, icon: AlertTriangle },
    { label: "Authoritative time", value: percent(data.canonical.authoritative_event_time_rate), detail: `${compact.format(data.canonical.authoritative_event_time)} source_occurred`, icon: CheckCircle2 },
    { label: "Provisional instances", value: compact.format(data.projection_quality.provisional), detail: `${compact.format(data.projection_quality.funnel_instances)} total instances`, icon: Activity },
  ]

  return <>
    <PageHeader title="Data health" description="Durable ingress, canonicalization, canonical-ledger, Funnel KPI and authoritative reconciliation evidence. Degraded business windows are gated explicitly." badge={<Badge tone={attention ? "warning" : "primary"} dot>{attention ? "Needs attention" : "Observed"}</Badge>} actions={<Button variant="outline" onClick={() => health.refetch()}><RefreshCw size={14} /> Refresh</Button>} />
    <div className="mb-4 flex flex-wrap gap-2 text-xs"><Badge>{sourceId}</Badge><Badge>{range}</Badge><Badge tone="primary">Ingress: received_at</Badge><Badge tone="primary">Canonical: persisted_at</Badge><Badge tone="primary">Projection: entry_at</Badge><Badge tone="primary">Reconciliation: coverage_end_at</Badge></div>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">{cards.map(({ label, value, detail, icon: Icon }) => <article key={label} className="panel p-4"><div className="flex items-center justify-between text-muted-foreground"><span className="text-xs font-medium">{label}</span><Icon size={16} /></div><strong className="mt-5 block text-2xl font-semibold">{value}</strong><p className="mt-2 text-[10px] text-muted-foreground">{detail}</p></article>)}</div>

    <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.45fr)_minmax(320px,.75fr)]"><ChartCard title="Canonical persistence" detail="Latest 48 populated hourly buckets in the selected window"><HealthTimelineChart buckets={data.hourly} /></ChartCard><ChartCard title="Canonical classes" detail="Persisted event class distribution"><div className="space-y-4 pt-3">{[
      ["Behavior intent", data.canonical.behavior_intent, "bg-sky-500"],
      ["Client observation", data.canonical.client_observation, "bg-slate-500"],
      ["Business fact", data.canonical.business_fact, "bg-emerald-500"],
    ].map(([label, count, color]) => { const share = data.canonical.events ? Number(count) / data.canonical.events * 100 : 0; return <div key={String(label)}><div className="mb-2 flex justify-between text-xs"><span>{label}</span><strong>{compact.format(Number(count))} · {share.toFixed(1)}%</strong></div><div className="h-2 rounded bg-muted"><div className={`h-full rounded ${color}`} style={{ width: `${share}%` }} /></div></div> })}</div><div className="mt-6 border-t pt-4 text-xs text-muted-foreground"><p>Persistence p95: <strong className="text-foreground">{duration(data.canonical.canonical_persistence_latency_p95_ms)}</strong></p><p className="mt-2">Source-produced fallback: <strong className="text-foreground">{compact.format(data.canonical.source_produced_time)}</strong></p></div></ChartCard></div>

    <div className="mt-4 grid gap-4 xl:grid-cols-2"><ChartCard title="Business reconciliation" detail="Latest comparison revision for each authoritative coverage window"><div className="mb-4 flex items-center justify-between rounded-lg border p-3"><div><p className="text-[10px] uppercase tracking-wider text-muted-foreground">Authoritative business gate</p><strong className="mt-1 block text-lg">{data.reconciliation.quality_gate.state}</strong></div><Badge tone={data.reconciliation.quality_gate.state === "RECONCILED" ? "success" : data.reconciliation.quality_gate.state === "DEGRADED" ? "danger" : "warning"} dot>{data.reconciliation.quality_gate.eligible_for_authoritative_business_analysis ? "Eligible" : "Gated"}</Badge></div><div className="grid grid-cols-4 gap-2">{[
      ["Provisional", data.reconciliation.provisional, "warning"],
      ["Reconciling", data.reconciliation.reconciling, "primary"],
      ["Reconciled", data.reconciliation.reconciled, "success"],
      ["Degraded", data.reconciliation.degraded, "danger"],
    ].map(([label, count, tone]) => <div key={String(label)} className="rounded-lg border p-3"><span className="text-[10px] text-muted-foreground">{label}</span><div className="mt-2"><strong className="text-xl">{compact.format(Number(count))}</strong><Badge className="ml-2" tone={tone as "warning" | "primary" | "success" | "danger"}>{label}</Badge></div></div>)}</div><div className="mt-4 grid grid-cols-3 gap-3 border-t pt-4 text-xs"><p>Missing<br/><strong className="text-foreground">{compact.format(data.reconciliation.missing_count)} · {percent(data.reconciliation.missing_rate)}</strong></p><p>Phantom<br/><strong className="text-foreground">{compact.format(data.reconciliation.phantom_count)} · {percent(data.reconciliation.phantom_rate)}</strong></p><p>State mismatch<br/><strong className="text-foreground">{compact.format(data.reconciliation.state_mismatch_count)} · {percent(data.reconciliation.state_mismatch_rate)}</strong></p></div></ChartCard><ChartCard title="Repair verification" detail="Append-only correction and post-repair comparison evidence"><div className="grid grid-cols-3 gap-3"><div className="rounded-lg border p-3"><span className="text-[10px] text-muted-foreground">Repairs</span><strong className="mt-2 block text-xl">{compact.format(data.reconciliation.repairs)}</strong></div><div className="rounded-lg border p-3"><span className="text-[10px] text-muted-foreground">Verified</span><strong className="mt-2 block text-xl">{compact.format(data.reconciliation.verified_repairs)}</strong></div><div className="rounded-lg border p-3"><span className="text-[10px] text-muted-foreground">Success rate</span><strong className="mt-2 block text-xl">{percent(data.reconciliation.repair_success_rate)}</strong></div></div><div className="mt-4 rounded-lg border p-4 text-xs text-muted-foreground"><p>Corrections: <strong className="text-foreground">{compact.format(data.reconciliation.successful_corrections)} / {compact.format(data.reconciliation.attempted_corrections)}</strong></p><p className="mt-2">Latest comparison: <strong className="text-foreground">{data.reconciliation.latest_comparison?.snapshot_id ?? "No evidence"}</strong></p><p className="mt-2">Revenue deviation: <strong className="text-foreground">{data.reconciliation.latest_comparison?.revenue_deviation.map((item) => `${item.currency} ${item.absolute_deviation}`).join(", ") || "—"}</strong></p></div></ChartCard></div>

    <div className="mt-4 grid gap-4 xl:grid-cols-3"><ChartCard title="Canonicalization outcomes" detail="Latest terminal outcome per accepted source event"><div className="grid grid-cols-3 gap-3">{[
      ["Normalized", data.canonicalization.normalized, "success"],
      ["Unsupported", data.canonicalization.unsupported, "warning"],
      ["Quarantined", data.canonicalization.quarantined, "danger"],
    ].map(([label, count, tone]) => <div key={String(label)} className="rounded-lg border p-3"><span className="text-[10px] text-muted-foreground">{label}</span><div className="mt-2 flex items-center justify-between gap-2"><strong className="text-xl">{compact.format(Number(count))}</strong><Badge tone={tone as "warning" | "success" | "danger"}>{label}</Badge></div></div>)}</div><div className="mt-5 border-t pt-4 text-xs text-muted-foreground"><p>Canonicalization p95: <strong className="text-foreground">{duration(data.canonicalization.canonicalization_latency_p95_ms)}</strong></p><p className="mt-2">Canonical normalization p95: <strong className="text-foreground">{duration(data.canonical.normalization_latency_p95_ms)}</strong></p><p className="mt-2">Ingress fallback time: <strong className="text-foreground">{compact.format(data.canonical.ingress_fallback_time)}</strong></p></div></ChartCard><ChartCard title="Funnel projection quality" detail="Outcome and quality are independent dimensions"><div className="grid grid-cols-2 gap-3">{[
      ["Provisional", data.projection_quality.provisional, "warning"],
      ["Reconciling", data.projection_quality.reconciling, "primary"],
      ["Reconciled", data.projection_quality.reconciled, "success"],
      ["Degraded", data.projection_quality.degraded, "danger"],
    ].map(([label, count, tone]) => <div key={String(label)} className="rounded-lg border p-3"><span className="text-[10px] text-muted-foreground">{label}</span><div className="mt-2 flex items-center justify-between"><strong className="text-xl">{compact.format(Number(count))}</strong><Badge tone={tone as "warning" | "primary" | "success" | "danger"}>{label}</Badge></div></div>)}</div></ChartCard><ChartCard title="Unavailable metrics" detail="Not fabricated without dedicated durable evidence"><div className="flex flex-wrap gap-2">{data.unavailable_metrics.map((metric) => <Badge key={metric}>{metric}</Badge>)}</div><div className="mt-5 flex gap-3 rounded-lg border border-warning/25 bg-warning/5 p-4"><ShieldAlert size={18} className="shrink-0 text-warning" /><p className="text-xs leading-5 text-muted-foreground">Reconciliation metrics become available only when matching authoritative snapshot/comparison evidence exists. Pre-handoff loss, duplicate attempts, rejected ingress and queue drops remain outside currently proven evidence.</p></div></ChartCard></div>
  </>
}
