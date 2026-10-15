import { useQuery } from "@tanstack/react-query"
import { CheckCircle2, CircleOff, DatabaseZap, RefreshCw, ShieldAlert, Sparkles } from "lucide-react"
import { useOutletContext } from "react-router-dom"
import type { ShellContext } from "../../app/AppShell"
import { Button } from "../../components/ui/button"
import { ProgressiveDetails } from "../../components/ui/progressive-details"
import { EmptyState, PageHeader } from "../../components/ui/page"
import { fetchV2DataHealth } from "../../lib/analytics-api"
import { compact } from "../../lib/utils"
import { DataHealthPage as DetailedDataHealthPage } from "./DataHealthPage"

export function FriendlyDataHealthPage() {
  const { range, sourceId } = useOutletContext<ShellContext>()
  const health = useQuery({ queryKey: ["v2-data-health", sourceId, range], queryFn: () => fetchV2DataHealth(range) })
  if (health.isLoading) return <div className="space-y-5"><div className="skeleton h-16 w-80" /><div className="skeleton h-64" /></div>
  if (health.isError || !health.data) return <EmptyState icon={<CircleOff size={20} />} title="Chưa tải được chất lượng dữ liệu" detail="Kiểm tra kết nối và phiên đăng nhập, rồi thử lại." />

  const data = health.data
  const reconciled = data.reconciliation.quality_gate.state === "RECONCILED"
    && data.reconciliation.quality_gate.eligible_for_authoritative_business_analysis
  const needsReview = data.canonicalization.quarantined > 0 || data.canonicalization.unsupported > 0 || data.projection_quality.degraded > 0

  return <>
    <PageHeader title="Chất lượng dữ liệu" description="Kiểm tra dữ liệu có thể dùng để phân tích đến mức nào." actions={<Button variant="outline" disabled={health.isFetching} onClick={() => void health.refetch()}><RefreshCw size={14} className={health.isFetching ? "animate-spin" : ""} /> Làm mới</Button>} />
    <section className={`panel relative overflow-hidden p-6 sm:p-8 ${needsReview || !reconciled ? "border-warning/25" : "border-success/25"}`}>
      <div className="absolute -right-12 -top-16 h-52 w-52 rounded-full bg-sky-200/25 blur-3xl dark:bg-blue-500/10" aria-hidden="true" />
      <div className="relative flex flex-wrap items-start gap-5"><span className={`grid h-14 w-14 shrink-0 place-items-center rounded-2xl ${needsReview || !reconciled ? "bg-warning/10 text-warning" : "bg-emerald-500/10 text-emerald-600"}`}>{needsReview || !reconciled ? <ShieldAlert size={27} /> : <CheckCircle2 size={27} />}</span><div className="max-w-2xl"><p className="text-xs font-semibold uppercase tracking-wider text-primary">Điều cần biết trước tiên</p><h2 className="mt-1 text-xl font-bold sm:text-2xl">{needsReview ? "Có dữ liệu cần kiểm tra" : reconciled ? "Đã có bằng chứng đối soát" : "Chưa đủ bằng chứng để kết luận"}</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">{needsReview ? "Một số sự kiện hoặc kết quả xử lý cần xem lại trước khi dùng để ra quyết định." : reconciled ? "Các cửa sổ dữ liệu trong phạm vi kiểm tra đã được đối soát. Vẫn cần xem phạm vi nguồn và thời gian trước khi kết luận." : "Dữ liệu vẫn có thể xem, nhưng chưa nên coi kết quả kinh doanh là số liệu chính thức."}</p></div></div>
    </section>
    <div className="mt-4 grid gap-4 sm:grid-cols-2"><article className="panel p-5"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-500/10 text-sky-600"><DatabaseZap size={19} /></span><h3 className="text-sm font-semibold">Sự kiện đã tiếp nhận</h3></div><p className="mt-4 text-3xl font-bold tracking-tight">{compact.format(data.canonicalization.accepted_events)}</p><p className="mt-2 text-xs text-muted-foreground">Lượt tiếp nhận có biên nhận bền vững trong phạm vi đã chọn.</p></article><article className="panel p-5"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/10 text-violet-600"><Sparkles size={19} /></span><h3 className="text-sm font-semibold">Sự kiện đã chuẩn hóa</h3></div><p className="mt-4 text-3xl font-bold tracking-tight">{compact.format(data.canonicalization.normalized)}</p><p className="mt-2 text-xs text-muted-foreground">Đây là kết quả xử lý, không lấy hiệu hai ô để suy ra thất thoát.</p></article></div>
    <ProgressiveDetails label="Xem biểu đồ và kiểm tra chuyên sâu"><DetailedDataHealthPage /></ProgressiveDetails>
    <p className="mt-4 text-xs text-muted-foreground">Nguồn: {sourceId} · Khoảng xem: {range}. Chất lượng dữ liệu không thay thế kiểm tra sức khỏe container hoặc đối soát nghiệp vụ ngoài phạm vi này.</p>
  </>
}
