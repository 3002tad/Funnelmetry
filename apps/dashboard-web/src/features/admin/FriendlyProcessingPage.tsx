import { useQuery } from "@tanstack/react-query"
import { Activity, CircleOff, DatabaseZap, RefreshCw, ShieldAlert } from "lucide-react"
import { useAuth } from "../../auth/AuthContext"
import { Button } from "../../components/ui/button"
import { EmptyState, PageHeader } from "../../components/ui/page"
import { ProgressiveDetails } from "../../components/ui/progressive-details"
import { analyticsSourceId, apiRequest } from "../../lib/api"
import ProcessingPage from "./ProcessingPage"

type Snapshot = { checked_at: string; stages: { stage: string; retained_count: string }[] }
type WorkerSnapshot = { reason?: string; workers: { worker: string; ready: boolean | null }[] }

export default function FriendlyProcessingPage() {
  const { user } = useAuth()
  const query = useQuery({ queryKey: ["admin-processing", user?.id, analyticsSourceId], queryFn: ({ signal }) => apiRequest<Snapshot>(`/api/v2/admin/processing?source_id=${encodeURIComponent(analyticsSourceId)}`, { signal }), retry: false })
  const workers = useQuery({ queryKey: ["admin-worker-readiness", user?.id], queryFn: ({ signal }) => apiRequest<WorkerSnapshot>("/api/v2/admin/worker-readiness", { signal }), retry: false })
  const canonical = query.data?.stages.find(stage => stage.stage === "canonical")
  const ready = workers.data?.workers.filter(worker => worker.ready === true).length ?? 0
  const total = workers.data?.workers.length ?? 0
  return <>
    <PageHeader title="Xử lý dữ liệu" description="Xem nhanh dấu vết đã lưu và tín hiệu tự báo của worker." actions={<Button variant="outline" disabled={query.isFetching || workers.isFetching} onClick={() => { void query.refetch(); void workers.refetch() }}><RefreshCw size={14} className={query.isFetching || workers.isFetching ? "animate-spin" : ""} /> Làm mới</Button>} />
    <section className="panel relative overflow-hidden p-6 sm:p-8"><div className="absolute -right-16 -top-20 h-56 w-56 rounded-full bg-cyan-200/25 blur-3xl dark:bg-cyan-500/10" aria-hidden="true" /><div className="relative flex items-start gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary/10 text-primary"><Activity size={23} /></span><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">Dòng xử lý</p><h2 className="mt-1 text-xl font-bold">Từ sự kiện đến dữ liệu phân tích</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Các chỉ số bên dưới là dấu vết đã lưu hoặc tín hiệu do tiến trình tự báo. Chúng chưa chứng minh toàn bộ luồng đã hoàn tất, không phải số đơn hay số khách.</p></div></div></section>
    {(query.isError || workers.isError) && <div className="mt-4"><EmptyState icon={<CircleOff size={20} />} title="Một phần trạng thái chưa tải được" detail="Không xem lỗi đọc dữ liệu là số 0. Mở chi tiết để biết chặng nào chưa xác minh." /></div>}
    <div className="mt-4 grid gap-4 sm:grid-cols-2"><article className="panel p-5"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-sky-500/10 text-sky-600"><DatabaseZap size={19} /></span><h3 className="text-sm font-semibold">Canonical đã lưu</h3></div><p className="mt-4 text-3xl font-bold tracking-tight">{canonical?.retained_count ?? "Chưa xác minh"}</p><p className="mt-2 text-xs text-muted-foreground">Số bản ghi còn lưu, không tính theo khoảng thời gian ở thanh trên.</p></article><article className="panel p-5"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-violet-500/10 text-violet-600"><ShieldAlert size={19} /></span><h3 className="text-sm font-semibold">Worker tự báo sẵn sàng</h3></div><p className="mt-4 text-3xl font-bold tracking-tight">{workers.data && !workers.data.reason ? `${ready}/${total}` : "Chưa xác minh"}</p><p className="mt-2 text-xs text-muted-foreground">Không thay thế kiểm tra từng replica, Kafka lag hoặc xử lý end-to-end.</p></article></div>
    <ProgressiveDetails label="Xem worker, Kafka lag và từng chặng xử lý"><ProcessingPage /></ProgressiveDetails>
    <p className="mt-4 text-xs text-muted-foreground">Nguồn: {analyticsSourceId}. Dữ liệu lưu trữ, readiness và lag là ba tín hiệu khác nhau; không lấy chênh lệch tổng để suy ra thất thoát.</p>
  </>
}
