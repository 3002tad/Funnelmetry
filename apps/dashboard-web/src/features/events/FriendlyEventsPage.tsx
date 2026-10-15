import { useMemo, useState } from "react"
import { useQuery } from "@tanstack/react-query"
import { ArrowUpRight, CircleOff, MousePointerClick, RefreshCw, Search, ShoppingBag } from "lucide-react"
import { useOutletContext } from "react-router-dom"
import type { ShellContext } from "../../app/AppShell"
import { useAuth } from "../../auth/AuthContext"
import { Badge } from "../../components/ui/badge"
import { Button } from "../../components/ui/button"
import { Drawer } from "../../components/ui/drawer"
import { EmptyState, PageHeader } from "../../components/ui/page"
import { ProgressiveDetails } from "../../components/ui/progressive-details"
import { ApiError } from "../../lib/api"
import { fetchV2Events, type CanonicalEventItem } from "../../lib/analytics-api"
import { classLabel, eventName } from "../../lib/event-labels"
import { EventBusinessDetails } from "./EventBusinessDetails"
import { EventsPage as DetailedEventsPage } from "./EventsPage"

export function FriendlyEventsPage() {
  const { range, sourceId } = useOutletContext<ShellContext>()
  const { user } = useAuth()
  const [search, setSearch] = useState("")
  const [selected, setSelected] = useState<CanonicalEventItem | null>(null)
  const [autoRefresh, setAutoRefresh] = useState(true)
  const events = useQuery({
    queryKey: ["v2-events", user?.id, sourceId, range, ""],
    queryFn: ({ signal }) => fetchV2Events(range, undefined, signal),
    refetchInterval: query => autoRefresh && !(query.state.error instanceof ApiError && [401, 403].includes(query.state.error.status)) ? 5000 : false,
    refetchIntervalInBackground: false,
    retry: false,
    gcTime: 0,
  })
  const visible = useMemo(() => {
    const needle = search.trim().toLowerCase()
    return (events.data ?? []).filter(event => !needle || eventName(event.event_type).toLowerCase().includes(needle) || event.event_type.toLowerCase().includes(needle) || event.canonical_event_id.toLowerCase().includes(needle)).slice(0, 24)
  }, [events.data, search])

  return <>
    <PageHeader title="Sự kiện" description="Các hành động và sự kiện đã được chuẩn hóa để bạn dễ theo dõi." actions={<Button variant="outline" disabled={events.isFetching} onClick={() => void events.refetch()}><RefreshCw size={14} className={events.isFetching ? "animate-spin" : ""} /> Làm mới</Button>} />
    <section className="panel mb-5 flex flex-wrap items-center gap-3 p-4"><div className="relative min-w-[220px] flex-1"><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input aria-label="Tìm sự kiện" value={search} onChange={event => setSearch(event.target.value)} placeholder="Tìm theo tên hoặc mã sự kiện…" className="h-11 w-full rounded-xl border bg-background pl-10 pr-3 text-sm" /></div><label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={autoRefresh} onChange={event => setAutoRefresh(event.target.checked)} /> Tự cập nhật</label></section>
    <p role="status" aria-live="polite" className="mb-4 text-xs text-muted-foreground">{events.isError ? "Chưa tải được dữ liệu mới. " : events.dataUpdatedAt ? `Đã cập nhật lúc ${new Date(events.dataUpdatedAt).toLocaleTimeString("vi-VN")}. ` : "Đang tải dữ liệu. "}Nguồn {sourceId} · {range} · tối đa 24 sự kiện hiển thị nhanh.</p>
    {events.isLoading && <div className="skeleton h-80" />}
    {events.isError && <EmptyState icon={<CircleOff size={20} />} title="Chưa tải được sự kiện" detail="Kiểm tra kết nối, nguồn dữ liệu và phiên đăng nhập, rồi thử lại." />}
    {!events.isLoading && !events.isError && (visible.length ? <div className="grid gap-3 md:grid-cols-2">{visible.map(event => {
      const commerce = event.event_class === "BUSINESS_FACT"
      const Icon = commerce ? ShoppingBag : MousePointerClick
      return <button key={event.canonical_event_id} type="button" onClick={() => setSelected(event)} className="panel group flex min-h-28 items-start gap-4 p-4 text-left transition hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary"><span className={`grid h-11 w-11 shrink-0 place-items-center rounded-2xl ${commerce ? "bg-emerald-500/10 text-emerald-600" : "bg-sky-500/10 text-sky-600"}`}><Icon size={21} aria-hidden="true" /></span><span className="min-w-0 flex-1"><strong className="block text-sm">{eventName(event.event_type)}</strong><span className="mt-1 block text-xs text-muted-foreground">{new Date(event.occurred_at).toLocaleString("vi-VN")}</span><span className="mt-3 block"><Badge tone={commerce ? "commerce" : "behavior"}>{classLabel(event.event_class)}</Badge></span></span><ArrowUpRight size={16} className="text-muted-foreground transition group-hover:text-primary" aria-hidden="true" /></button>
    })}</div> : <EmptyState icon={<CircleOff size={20} />} title="Chưa có sự kiện phù hợp" detail="Thử đổi từ khóa hoặc khoảng thời gian ở thanh trên." />)}
    <ProgressiveDetails label="Xem bảng, bộ lọc và mã kỹ thuật"><DetailedEventsPage /></ProgressiveDetails>
    <Drawer open={Boolean(selected)} onClose={() => setSelected(null)} title={selected ? eventName(selected.event_type) : "Sự kiện"}>
      {selected && <><p className="text-sm text-muted-foreground">Ghi nhận lúc {new Date(selected.occurred_at).toLocaleString("vi-VN")}. Đây là sự kiện đã chuẩn hóa, không phải toàn bộ payload gốc.</p><EventBusinessDetails event={selected} /><details className="mt-5 rounded-xl border p-4"><summary className="cursor-pointer text-sm font-semibold">Thông tin kỹ thuật</summary><dl className="mt-4 grid grid-cols-[110px_minmax(0,1fr)] gap-3 text-xs"><dt>Loại</dt><dd>{selected.event_type}</dd><dt>ID</dt><dd className="break-all font-mono">{selected.canonical_event_id}</dd><dt>Hành trình</dt><dd className="break-all font-mono">{selected.journey_id ?? "Chưa liên kết"}</dd><dt>Thời gian</dt><dd>{selected.time_basis}</dd><dt>Mapping</dt><dd>{selected.mapping_version}</dd></dl></details></>}
    </Drawer>
  </>
}
