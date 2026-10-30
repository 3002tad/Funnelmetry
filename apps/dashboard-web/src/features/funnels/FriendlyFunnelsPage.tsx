import { useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { CircleOff, RefreshCw, Route, ShieldAlert } from "lucide-react"
import { useOutletContext } from "react-router-dom"
import type { ShellContext } from "../../app/AppShell"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { EmptyState, PageHeader } from "../../components/ui/page"
import { ProgressiveDetails } from "../../components/ui/progressive-details"
import { fetchV2Funnel, fetchV2Overview } from "../../lib/analytics-api"
import { eventName } from "../../lib/event-labels"
import { compact } from "../../lib/utils"
import { FunnelsPage as DetailedFunnelsPage } from "./FunnelsPage"
import { ReferenceCdcCandidatePanel } from './ReferenceCdcCandidatePanel'

export function FriendlyFunnelsPage() {
  const { range, sourceId } = useOutletContext<ShellContext>()
  const [selectedKey, setSelectedKey] = useState("")
  const profiles = useQuery({ queryKey: ["v2-overview", sourceId, range], queryFn: () => fetchV2Overview(range) })
  const selected = profiles.data?.profiles.find(profile => `${profile.funnel_profile_id}:${profile.profile_version}` === selectedKey) ?? profiles.data?.profiles[0]
  const funnel = useQuery({ queryKey: ["v2-funnel", sourceId, range, selected?.funnel_profile_id, selected?.profile_version], queryFn: () => fetchV2Funnel(selected!.funnel_profile_id, selected!.profile_version, range), enabled: Boolean(selected) })
  if (profiles.isLoading) return <div className="skeleton h-80" />
  if (profiles.isError) return <EmptyState icon={<CircleOff size={20} />} title="Chưa tải được các phễu" detail="Kiểm tra kết nối và phiên đăng nhập, rồi thử lại." />
  if (!selected) return <><EmptyState icon={<CircleOff size={20} />} title="Chưa có phễu để xem" detail="Phễu sẽ xuất hiện sau khi được xuất bản và có dữ liệu phù hợp." /><ReferenceCdcCandidatePanel sourceId={sourceId} range={range} /></>

  const data = funnel.data
  const rate = data?.totals.observed_end_to_end_rate
  return <>
    <PageHeader title="Hành trình chuyển đổi" description="Xem lượt đi qua từng bước của một phễu. Chọn phễu để thay đổi góc nhìn." actions={<Button variant="outline" disabled={funnel.isFetching} onClick={() => void funnel.refetch()}><RefreshCw size={14} className={funnel.isFetching ? "animate-spin" : ""} /> Làm mới</Button>} />
    <label className="mb-5 block max-w-md text-sm font-semibold">Chọn hành trình<select className="mt-2 block h-11 w-full rounded-xl border bg-card px-3 text-sm" value={`${selected.funnel_profile_id}:${selected.profile_version}`} onChange={event => setSelectedKey(event.target.value)}>{profiles.data?.profiles.map(profile => <option key={`${profile.funnel_profile_id}:${profile.profile_version}`} value={`${profile.funnel_profile_id}:${profile.profile_version}`}>{profile.display_name} · phiên bản {profile.profile_version}</option>)}</select></label>
    {funnel.isLoading && <div className="skeleton h-80" />}
    {funnel.isError && <EmptyState icon={<CircleOff size={20} />} title="Chưa tải được hành trình này" detail="Phễu có thể chưa hoạt động hoặc chưa có dữ liệu phù hợp." />}
    {data && <>
      <section className="panel relative overflow-hidden p-6 sm:p-8"><div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-violet-200/25 blur-3xl dark:bg-violet-500/10" aria-hidden="true" /><div className="relative flex flex-wrap items-center gap-6"><span className="grid h-16 w-16 shrink-0 place-items-center rounded-3xl bg-violet-500/10 text-violet-600"><Route size={30} /></span><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">Kết quả đã quan sát</p><h2 className="mt-1 text-2xl font-bold">{rate === null || rate === undefined ? "Chưa tính được tỷ lệ" : `${(rate * 100).toFixed(1)}% đi tới bước cuối`}</h2><p className="mt-2 text-sm text-muted-foreground">{compact.format(data.totals.observed_converted)} trên {compact.format(data.totals.entrants)} lượt bắt đầu trong khoảng đã chọn.</p></div></div><p className="relative mt-5 text-xs text-muted-foreground">Đây là kết quả quan sát theo lượt, chưa phải tỷ lệ cuối cùng hoặc số khách hàng duy nhất.</p></section>
      <section className="mt-5" aria-label="Các bước của phễu"><div className="mb-4 flex flex-wrap items-center justify-between gap-2"><h2 className="text-base font-bold">Các bước trong hành trình</h2><Badge tone="primary">{data.steps.length} bước</Badge></div><div className="grid gap-3 md:grid-cols-2">{data.steps.map((step, index) => {
        const share = step.observed_reach_rate === null ? 0 : Math.max(0, Math.min(100, step.observed_reach_rate * 100))
        return <article key={step.step_id} className="panel p-5"><div className="flex items-center gap-3"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-sm font-bold text-primary">{index + 1}</span><div className="min-w-0"><h3 className="text-sm font-semibold">{eventName(step.event_type)}</h3><p className="text-xs text-muted-foreground">{compact.format(step.reached)} lượt đã tới bước này</p></div></div><div className="mt-5 h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-gradient-to-r from-sky-500 to-indigo-500" style={{ width: `${share}%` }} /></div><p className="mt-2 text-xs text-muted-foreground">{step.observed_reach_rate === null ? "Chưa đủ dữ liệu để tính tỷ lệ" : `${share.toFixed(1)}% của lượt bắt đầu`}</p></article>
      })}</div></section>
      {(data.totals.degraded > 0 || data.totals.provisional > 0) && <p className="mt-4 flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/5 p-4 text-xs leading-5 text-muted-foreground"><ShieldAlert size={17} className="shrink-0 text-warning" />Một phần dữ liệu vẫn tạm thời hoặc cần kiểm tra chất lượng. Không dùng tỷ lệ này như KPI cuối cùng.</p>}
    </>}
    <ReferenceCdcCandidatePanel sourceId={sourceId} range={range} />
    <ProgressiveDetails label="Xem phân tích và mã kỹ thuật đầy đủ"><DetailedFunnelsPage /></ProgressiveDetails>
    <p className="mt-4 text-xs text-muted-foreground">Nguồn: {sourceId} · Khoảng xem: {range}.</p>
  </>
}
