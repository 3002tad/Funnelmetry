import { useQuery } from "@tanstack/react-query"
import { Activity, CircleOff, DatabaseZap, MousePointerClick, RefreshCw, Route, TimerReset } from "lucide-react"
import { useOutletContext } from "react-router-dom"
import type { ShellContext } from "../../app/AppShell"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { EmptyState, PageHeader } from "../../components/ui/page"
import { fetchV2Overview } from "../../lib/analytics-api"
import { compact } from "../../lib/utils"

function percent(value: number | null) {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`
}

export function OverviewPage() {
  const { range, sourceId } = useOutletContext<ShellContext>()
  const overview = useQuery({ queryKey: ["v2-overview", sourceId, range], queryFn: () => fetchV2Overview(range) })
  if (overview.isLoading) return <div className="space-y-5"><div className="skeleton h-16 w-80" /><div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[1,2,3,4].map((n) => <div key={n} className="skeleton h-28" />)}</div><div className="skeleton h-72" /></div>
  if (overview.isError) return <EmptyState icon={<CircleOff size={20} />} title="Không tải được Analytics API V2" detail="Kiểm tra Dashboard API, PostgreSQL migrations và phiên đăng nhập rồi thử lại." />

  const profiles = overview.data?.profiles ?? []
  const totals = profiles.reduce((value, profile) => ({
    entrants: value.entrants + profile.entrants,
    converted: value.converted + profile.observed_converted,
    pending: value.pending + profile.pending,
    provisional: value.provisional + profile.provisional,
    degraded: value.degraded + profile.degraded,
  }), { entrants: 0, converted: 0, pending: 0, provisional: 0, degraded: 0 })
  const observedRate = totals.entrants === 0 ? null : totals.converted / totals.entrants

  return <>
    <PageHeader title="Overview" description="Observed Funnel Instance cohorts from the V2 analytics projection." badge={<Badge tone="primary" dot>Observed</Badge>} actions={<Button variant="outline" onClick={() => overview.refetch()}><RefreshCw size={14} /> Refresh</Button>} />
    <div className="mb-5 flex flex-wrap gap-2 text-xs"><Badge>{range}</Badge><Badge>{sourceId}</Badge><Badge tone="warning">Entry-at cohort · not matured</Badge></div>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      {[
        ["Profile entrants", compact.format(totals.entrants), Route],
        ["Observed converted", compact.format(totals.converted), MousePointerClick],
        ["Observed conversion", percent(observedRate), Activity],
        ["Pending instances", compact.format(totals.pending), TimerReset],
      ].map(([label, value, Icon]) => <article key={String(label)} className="panel p-4"><div className="flex items-center justify-between text-muted-foreground"><span className="text-xs font-medium">{String(label)}</span><Icon size={16} /></div><strong className="mt-5 block text-2xl font-semibold">{String(value)}</strong><p className="mt-2 text-[10px] text-muted-foreground">Funnel Profile instances in selected cohort</p></article>)}
    </div>

    {profiles.length === 0 ? <div className="mt-4"><EmptyState icon={<CircleOff size={20} />} title="Chưa có Funnel Instance" detail="Hãy chạy pipeline, publish reference profile và gửi event cho source đang chọn." /></div> : <section className="panel mt-4 overflow-hidden">
      <div className="border-b p-5"><h2 className="text-sm font-semibold">Funnel profiles</h2><p className="mt-1 text-xs text-muted-foreground">Mỗi profile/version là một cohort độc lập; không cộng thành unique customers.</p></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-xs"><thead className="bg-muted/30 text-muted-foreground"><tr>{["Profile", "Version", "Entrants", "Converted", "Observed rate", "Pending", "Quality"].map((heading) => <th key={heading} className="px-5 py-3 font-medium">{heading}</th>)}</tr></thead><tbody>{profiles.map((profile) => <tr key={`${profile.funnel_profile_id}:${profile.profile_version}`} className="border-t"><td className="px-5 py-4"><strong>{profile.display_name}</strong><span className="mt-1 block font-mono text-[10px] text-muted-foreground">{profile.funnel_profile_id}</span></td><td className="font-mono">{profile.profile_version}</td><td>{compact.format(profile.entrants)}</td><td>{compact.format(profile.observed_converted)}</td><td>{percent(profile.observed_end_to_end_rate)}</td><td>{compact.format(profile.pending)}</td><td><Badge tone={profile.degraded ? "danger" : profile.provisional ? "warning" : "success"}>{profile.degraded ? `${profile.degraded} degraded` : profile.provisional ? `${profile.provisional} provisional` : `${profile.reconciled} reconciled`}</Badge></td></tr>)}</tbody></table></div>
    </section>}

    <div className="mt-4 panel flex flex-col gap-4 p-4 sm:flex-row sm:items-center"><div className={`grid h-10 w-10 place-items-center rounded-lg ${totals.degraded ? "bg-destructive/10 text-destructive" : "bg-warning/10 text-warning"}`}><DatabaseZap size={18} /></div><div className="flex-1"><strong className="text-sm">Projection quality is explicit</strong><p className="mt-1 text-xs text-muted-foreground">{compact.format(totals.provisional)} provisional and {compact.format(totals.degraded)} degraded profile instances. Observed conversion is not a final matured KPI.</p></div></div>
  </>
}
