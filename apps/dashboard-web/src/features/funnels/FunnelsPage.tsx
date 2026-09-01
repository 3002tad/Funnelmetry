import { useEffect, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CircleOff, MousePointerClick, RefreshCw, TimerReset, Users } from "lucide-react"
import { useOutletContext } from "react-router-dom"
import type { ShellContext } from "../../app/AppShell"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { EmptyState, PageHeader } from "../../components/ui/page"
import { fetchV2Funnel, fetchV2Overview } from "../../lib/analytics-api"
import { compact } from "../../lib/utils"

function percent(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`
}

export function FunnelsPage() {
  const { range, sourceId } = useOutletContext<ShellContext>()
  const [selectedKey, setSelectedKey] = useState("")
  const [activeStep, setActiveStep] = useState(0)
  const profiles = useQuery({ queryKey: ["v2-overview", sourceId, range], queryFn: () => fetchV2Overview(range) })
  const selected = profiles.data?.profiles.find((profile) => `${profile.funnel_profile_id}:${profile.profile_version}` === selectedKey) ?? profiles.data?.profiles[0]
  useEffect(() => {
    if (selected && !selectedKey) setSelectedKey(`${selected.funnel_profile_id}:${selected.profile_version}`)
  }, [selected, selectedKey])
  const funnel = useQuery({
    queryKey: ["v2-funnel", sourceId, range, selected?.funnel_profile_id, selected?.profile_version],
    queryFn: () => fetchV2Funnel(selected!.funnel_profile_id, selected!.profile_version, range),
    enabled: Boolean(selected),
  })
  useEffect(() => setActiveStep(0), [selectedKey])

  if (profiles.isLoading) return <div className="space-y-4"><div className="skeleton h-16 w-80" /><div className="skeleton h-32" /><div className="skeleton h-96" /></div>
  if (profiles.isError) return <EmptyState icon={<CircleOff size={20} />} title="Không tải được danh sách funnel" detail="Kiểm tra Dashboard API V2 và phiên đăng nhập." />
  if (!selected) return <EmptyState icon={<CircleOff size={20} />} title="Chưa có Funnel Profile data" detail="Publish reference profile và chạy pipeline trước khi mở Funnel analysis." />
  if (funnel.isLoading || !funnel.data) return <div className="space-y-4"><div className="skeleton h-16 w-80" /><div className="skeleton h-32" /><div className="skeleton h-96" /></div>
  if (funnel.isError) return <EmptyState icon={<CircleOff size={20} />} title="Không tải được funnel projection" detail="Profile có thể chưa active hoặc migration KPI chưa được áp dụng." />

  const data = funnel.data
  const active = data.steps[Math.min(activeStep, Math.max(data.steps.length - 1, 0))]
  return <>
    <PageHeader title="Funnel analysis" description="Observed step reach from immutable, versioned Funnel Profiles." badge={<Badge tone="primary">Observed / {data.totals.provisional ? "Provisional" : "Reconciled"}</Badge>} actions={<Button variant="outline" onClick={() => funnel.refetch()}><RefreshCw size={14} /> Refresh</Button>} />
    <div className="mb-5 flex flex-wrap gap-2">
      {profiles.data?.profiles.map((profile) => <button key={`${profile.funnel_profile_id}:${profile.profile_version}`} onClick={() => setSelectedKey(`${profile.funnel_profile_id}:${profile.profile_version}`)} className={`rounded-lg border px-3 py-2 text-xs ${profile.funnel_profile_id === selected.funnel_profile_id && profile.profile_version === selected.profile_version ? "border-primary/50 bg-primary/10 text-primary" : "bg-card text-muted-foreground"}`}>{profile.display_name} · {profile.profile_version}</button>)}
      <Badge>{range}</Badge><Badge>{sourceId}</Badge>
    </div>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {[
        ["Funnel entrants", compact.format(data.totals.entrants), Users],
        ["Observed converted", compact.format(data.totals.observed_converted), MousePointerClick],
        ["Observed rate", percent(data.totals.observed_end_to_end_rate), TimerReset],
        ["Pending", compact.format(data.totals.pending), TimerReset],
      ].map(([label, value, Icon]) => <article key={String(label)} className="panel p-4"><div className="flex items-center justify-between text-muted-foreground"><span className="text-xs">{String(label)}</span><Icon size={16} /></div><strong className="mt-5 block text-2xl">{String(value)}</strong><span className="mt-2 block text-[10px] text-muted-foreground">Entry-at cohort · not final maturity</span></article>)}
    </div>

    <div className="mt-4 grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="panel p-5"><div className="mb-6"><h2 className="text-sm font-semibold">{data.profile.display_name}</h2><p className="mt-1 font-mono text-[10px] text-muted-foreground">{data.profile.funnel_profile_id}@{data.profile.profile_version}</p></div>
        <div className="space-y-2">{data.steps.map((step, index) => {
          const prior = index === 0 ? step.entrants : data.steps[index - 1].reached
          const transition = prior === 0 ? null : step.reached / prior
          return <button key={step.step_id} onClick={() => setActiveStep(index)} className={`w-full rounded-lg border p-4 text-left transition ${activeStep === index ? "border-primary/60 bg-primary/10" : "bg-muted/20 hover:border-primary/30"}`} style={{ width: `${Math.max(68, 100 - index * 8)}%` }}><div className="flex items-center justify-between gap-4"><div><span className="text-[10px] uppercase tracking-wider text-muted-foreground">Step {index + 1} · {step.event_class}</span><strong className="mt-1 block font-mono text-xs">{step.event_type}</strong></div><div className="flex gap-6 text-right"><div><span className="block text-[10px] text-muted-foreground">Transition</span><strong>{index === 0 ? "—" : percent(transition)}</strong></div><div><strong className="block text-lg">{compact.format(step.reached)}</strong><span className="text-[10px] text-muted-foreground">{percent(step.observed_reach_rate)} reached</span></div></div></div></button>
        })}</div>
      </section>
      <aside className="panel p-5"><p className="eyebrow">Selected step</p>{active ? <><h2 className="mt-2 font-mono text-sm font-semibold">{active.event_type}</h2><div className="mt-5 grid grid-cols-2 gap-2"><div className="rounded-lg border p-3"><span className="text-[10px] text-muted-foreground">Reached</span><strong className="mt-1 block text-lg">{compact.format(active.reached)}</strong></div><div className="rounded-lg border p-3"><span className="text-[10px] text-muted-foreground">Observed rate</span><strong className="mt-1 block text-lg">{percent(active.observed_reach_rate)}</strong></div></div><div className="mt-5 space-y-3 text-xs"><div className="flex justify-between"><span className="text-muted-foreground">Authority class</span><Badge tone={active.event_class === "BUSINESS_FACT" ? "commerce" : "behavior"}>{active.event_class}</Badge></div><div className="flex justify-between"><span className="text-muted-foreground">Step ID</span><span className="font-mono">{active.step_id}</span></div></div></> : <p className="mt-3 text-xs text-muted-foreground">Profile chưa có step.</p>}
        <div className="mt-6 border-t pt-4"><h3 className="text-xs font-medium">Quality context</h3><div className="mt-3 grid grid-cols-2 gap-2 text-xs"><div className="rounded-lg bg-muted/40 p-3"><span className="text-muted-foreground">Provisional</span><strong className="mt-1 block">{data.totals.provisional}</strong></div><div className="rounded-lg bg-muted/40 p-3"><span className="text-muted-foreground">Degraded</span><strong className="mt-1 block">{data.totals.degraded}</strong></div><div className="rounded-lg bg-muted/40 p-3"><span className="text-muted-foreground">Dropped</span><strong className="mt-1 block">{data.totals.dropped}</strong></div><div className="rounded-lg bg-muted/40 p-3"><span className="text-muted-foreground">Reconciled</span><strong className="mt-1 block">{data.totals.reconciled}</strong></div></div></div>
      </aside>
    </div>
  </>
}
