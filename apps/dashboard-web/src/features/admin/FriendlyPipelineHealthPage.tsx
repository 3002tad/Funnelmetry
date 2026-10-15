import { useQuery } from "@tanstack/react-query"
import { ArrowRight, CircleOff, Database, Layers3, RefreshCw, ShieldAlert } from "lucide-react"
import { apiRequest, analyticsSourceId } from "../../lib/api"
import { Button } from "../../components/ui/button"
import { EmptyState, PageHeader } from "../../components/ui/page"
import { ProgressiveDetails } from "../../components/ui/progressive-details"
import PipelineHealthPage from "./PipelineHealthPage"

type PipelineSnapshot = {
  checked_at: string
  metrics: { accepted: number; canonical: number; pending_claims: number }
}

export default function FriendlyPipelineHealthPage() {
  const query = useQuery({
    queryKey: ["admin-pipeline", analyticsSourceId],
    queryFn: ({ signal }) => apiRequest<PipelineSnapshot>(`/api/v2/admin/pipeline?source_id=${encodeURIComponent(analyticsSourceId)}`, { signal }),
    refetchInterval: 15000,
  })
  return <>
    <PageHeader title="Tình trạng Pipeline" description="Nhìn nhanh dữ liệu đã được hệ thống lưu lại; mở chi tiết khi cần điều tra." actions={<Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}><RefreshCw size={14} className={query.isFetching ? "animate-spin" : ""} /> Làm mới</Button>} />
    <section className="panel relative overflow-hidden p-6 sm:p-8"><div className="absolute -right-16 -top-24 h-64 w-64 rounded-full bg-sky-200/30 blur-3xl dark:bg-blue-500/10" aria-hidden="true" /><div className="relative flex items-start gap-4"><span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-warning/10 text-warning"><ShieldAlert size={23} /></span><div><p className="text-xs font-semibold uppercase tracking-wider text-primary">Điều cần biết</p><h2 className="mt-1 text-xl font-bold">Dữ liệu lưu trữ không xác nhận worker đang chạy</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Trang này cho biết những gì PostgreSQL đã ghi nhận. Muốn xác nhận sức khỏe runtime, cần đối chiếu riêng trạng thái service và xử lý sự kiện mới.</p></div></div></section>
    {query.isPending && <div className="skeleton mt-4 h-40" />}
    {query.isError && <div className="mt-4"><EmptyState icon={<CircleOff size={20} />} title="Chưa tải được dữ liệu Pipeline" detail="Kiểm tra quyền truy cập hoặc kết nối Dashboard API, rồi thử lại." /></div>}
    {query.data && <><div className="mt-4 grid items-stretch gap-4 md:grid-cols-[1fr_auto_1fr]"><article className="panel p-5"><div className="flex items-center gap-3 text-primary"><Database size={20} /><h3 className="text-sm font-semibold text-foreground">Đã tiếp nhận</h3></div><p className="mt-5 text-4xl font-bold tracking-tight">{query.data.metrics.accepted.toLocaleString("vi-VN")}</p><p className="mt-2 text-xs text-muted-foreground">Biên nhận đã lưu trong cơ sở dữ liệu.</p></article><span className="hidden items-center text-primary md:flex"><ArrowRight size={24} aria-hidden="true" /></span><article className="panel p-5"><div className="flex items-center gap-3 text-violet-600"><Layers3 size={20} /><h3 className="text-sm font-semibold text-foreground">Đã chuẩn hóa</h3></div><p className="mt-5 text-4xl font-bold tracking-tight">{query.data.metrics.canonical.toLocaleString("vi-VN")}</p><p className="mt-2 text-xs text-muted-foreground">Sự kiện canonical đã được lưu.</p></article></div><p className="mt-3 text-xs text-muted-foreground">Số liệu tích lũy, không theo bộ lọc thời gian ở thanh trên. Không lấy chênh lệch hai số để suy ra mất dữ liệu. Lần kiểm tra: {new Date(query.data.checked_at).toLocaleString("vi-VN")}.</p></>}
    <ProgressiveDetails label="Xem số liệu xử lý và dấu mốc kỹ thuật"><PipelineHealthPage /></ProgressiveDetails>
  </>
}
