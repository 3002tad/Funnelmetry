import { useQuery } from "@tanstack/react-query"
import { CircleOff, RefreshCw, Route, ShieldAlert } from "lucide-react"
import { useOutletContext } from "react-router-dom"
import type { ShellContext } from "../../app/AppShell"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { ProgressiveDetails } from "../../components/ui/progressive-details"
import { EmptyState, PageHeader } from "../../components/ui/page"
import { fetchV2Overview } from "../../lib/analytics-api"
import { compact } from "../../lib/utils"
import { OverviewPage as DetailedOverviewPage } from "./OverviewPage"

function JourneyArtwork() {
  return <svg className="h-52 w-full max-w-sm sm:h-64" viewBox="0 0 360 250" fill="none" aria-hidden="true">
    <defs><linearGradient id="journey-line" x1="34" y1="197" x2="320" y2="50" gradientUnits="userSpaceOnUse"><stop stopColor="#38bdf8"/><stop offset="1" stopColor="#6366f1"/></linearGradient><linearGradient id="journey-fill" x1="0" y1="0" x2="1" y2="1"><stop stopColor="#e0f2fe"/><stop offset="1" stopColor="#eef2ff"/></linearGradient></defs>
    <circle cx="180" cy="125" r="116" fill="url(#journey-fill)" opacity=".8"/>
    <circle cx="180" cy="125" r="86" stroke="#bfdbfe" strokeDasharray="4 8"/>
    <path d="M43 183C98 194 99 91 164 118S229 187 314 55" stroke="url(#journey-line)" strokeWidth="12" strokeLinecap="round"/>
    <path d="M43 183C98 194 99 91 164 118S229 187 314 55" stroke="white" strokeOpacity=".7" strokeWidth="2" strokeLinecap="round"/>
    <circle cx="43" cy="183" r="21" fill="white" stroke="#7dd3fc" strokeWidth="5"/><circle cx="164" cy="118" r="21" fill="white" stroke="#60a5fa" strokeWidth="5"/><circle cx="314" cy="55" r="24" fill="white" stroke="#818cf8" strokeWidth="5"/>
    <path d="m307 55 5 5 9-11" stroke="#6366f1" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
    <circle cx="254" cy="213" r="13" fill="#bae6fd" opacity=".75"/><circle cx="83" cy="44" r="9" fill="#c7d2fe" opacity=".8"/>
  </svg>
}

export function FriendlyOverviewPage() {
  const { range, sourceId } = useOutletContext<ShellContext>()
  const overview = useQuery({ queryKey: ["v2-overview", sourceId, range], queryFn: () => fetchV2Overview(range) })
  if (overview.isLoading) return <div className="space-y-5"><div className="skeleton h-16 w-80" /><div className="skeleton h-64" /></div>
  if (overview.isError) return <EmptyState icon={<CircleOff size={20} />} title="Chưa tải được dữ liệu tổng quan" detail="Kiểm tra kết nối và phiên đăng nhập, rồi thử lại." />

  const profiles = overview.data?.profiles ?? []
  const totals = profiles.reduce((value, profile) => ({
    entrants: value.entrants + profile.entrants,
    converted: value.converted + profile.observed_converted,
    pending: value.pending + profile.pending,
    provisional: value.provisional + profile.provisional,
    degraded: value.degraded + profile.degraded,
  }), { entrants: 0, converted: 0, pending: 0, provisional: 0, degraded: 0 })
  const observedRate = totals.entrants > 0 ? `${(totals.converted / totals.entrants * 100).toFixed(1)}%` : "—"

  return <>
    <PageHeader title="Tổng quan" description="Một cái nhìn nhanh về hành trình mua sắm trong khoảng thời gian bạn chọn." actions={<Button variant="outline" disabled={overview.isFetching} onClick={() => void overview.refetch()}><RefreshCw size={14} className={overview.isFetching ? "animate-spin" : ""} /> Làm mới</Button>} />
    {profiles.length === 0 ? <EmptyState icon={<CircleOff size={20} />} title="Chưa có hành trình để hiển thị" detail="Khi nguồn dữ liệu có sự kiện và phễu được xuất bản, kết quả sẽ xuất hiện ở đây." /> : <>
      <section className="panel relative overflow-hidden p-6 sm:p-8" aria-labelledby="overview-story-title">
        <div className="absolute -right-20 -top-28 h-64 w-64 rounded-full bg-sky-200/30 blur-3xl dark:bg-blue-500/10" aria-hidden="true" />
        <div className="relative grid items-center gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(260px,.55fr)]"><div>
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">Bức tranh nhanh</p><h2 id="overview-story-title" className="mt-2 text-xl font-bold tracking-tight sm:text-2xl">Có bao nhiêu lượt đi tới bước cuối?</h2></div><span className="grid h-11 w-11 place-items-center rounded-2xl bg-primary/10 text-primary"><Route size={22} aria-hidden="true" /></span></div>
        <div className="mt-7 flex flex-wrap items-end gap-x-6 gap-y-2"><strong className="text-5xl font-bold tracking-tight text-primary sm:text-6xl">{observedRate}</strong><p className="max-w-lg pb-1 text-sm leading-6 text-muted-foreground">Trong {compact.format(totals.entrants)} lượt bắt đầu, đã quan sát {compact.format(totals.converted)} lượt tới bước cuối của phễu.</p></div>
        <div className="mt-7 flex flex-wrap gap-2"><Badge tone="primary">Đã quan sát, chưa chốt cuối cùng</Badge>{totals.pending > 0 && <Badge>{compact.format(totals.pending)} lượt đang tiếp diễn</Badge>}</div>
        <p className="mt-4 max-w-3xl text-xs leading-5 text-muted-foreground">Đây là lượt theo các phễu, không phải số khách hàng duy nhất hay số đơn đã thanh toán. Một người có thể tham gia nhiều phễu.</p>
        </div><div className="mx-auto w-full max-w-sm"><JourneyArtwork /><p className="text-center text-[11px] text-muted-foreground">Minh họa hành trình · không phải biểu đồ dữ liệu</p></div></div>
      </section>
      {(totals.degraded > 0 || totals.provisional > 0) && <section className="mt-4 flex gap-3 rounded-2xl border border-warning/25 bg-warning/5 p-4" aria-label="Lưu ý chất lượng dữ liệu"><ShieldAlert size={19} className="mt-0.5 shrink-0 text-warning" /><div><strong className="text-sm">Kết quả cần đọc thận trọng</strong><p className="mt-1 text-xs leading-5 text-muted-foreground">Một số lượt còn tạm thời hoặc có vấn đề chất lượng. Xem phần chi tiết trước khi dùng làm kết luận chính thức.</p></div></section>}
    </>}
    <ProgressiveDetails label="Xem số liệu và bằng chứng chi tiết"><DetailedOverviewPage /></ProgressiveDetails>
    <p className="mt-4 text-xs text-muted-foreground">Nguồn: {sourceId} · Khoảng xem: {range}. Kết quả trên là trạng thái đã quan sát, chưa phải tỷ lệ cuối cùng.</p>
  </>
}
