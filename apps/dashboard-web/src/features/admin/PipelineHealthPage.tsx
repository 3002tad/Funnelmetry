import { useQuery } from '@tanstack/react-query'
import { Activity, CircleAlert, Database, Layers3, RefreshCw, ShieldAlert, Timer } from 'lucide-react'
import { apiRequest, analyticsSourceId } from '../../lib/api'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { PageHeader } from '../../components/ui/page'

type Health = { source_id: string; checked_at: string; runtime_status: string;
  metrics: { accepted: number; terminal: number; canonical: number; kpi_applications: number;
    pending_claims: number; last_canonical_at: string | null; last_kpi_at: string | null }; unavailable: string[] }

export default function PipelineHealthPage() {
  const query = useQuery({ queryKey: ['admin-pipeline', analyticsSourceId],
    queryFn: ({ signal }) => apiRequest<Health>(`/api/v2/admin/pipeline?source_id=${encodeURIComponent(analyticsSourceId)}`, { signal }),
    refetchInterval: 15000 })

  const cards = query.data ? [
    { label: 'Accepted receipts', value: query.data.metrics.accepted, icon: Database },
    { label: 'Terminal outcomes', value: query.data.metrics.terminal, icon: Activity },
    { label: 'Canonical events', value: query.data.metrics.canonical, icon: Layers3 },
    { label: 'KPI applications', value: query.data.metrics.kpi_applications, icon: Activity },
    { label: 'Claims đang chờ', value: query.data.metrics.pending_claims, icon: Timer },
  ] : []

  return <div className="space-y-6">
    <PageHeader title="Pipeline Health" description={`Nguồn: ${analyticsSourceId}. Số liệu tích lũy còn lưu trong PostgreSQL V2, không theo bộ lọc thời gian phía trên.`}
      badge={<Badge tone="warning" dot>{query.error && query.data ? 'Dữ liệu cũ · runtime chưa xác minh' : 'Runtime chưa xác minh'}</Badge>}
      actions={<Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={15} className={query.isFetching ? 'animate-spin' : ''} />Làm mới</Button>} />

    <section className="panel flex gap-4 border-warning/30 bg-warning/5 p-5" aria-label="Giới hạn trạng thái runtime">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-warning/10 text-warning"><ShieldAlert size={19} /></span>
      <div><h2 className="text-sm font-semibold">Trạng thái runtime: chưa xác minh</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">Có dữ liệu trong PostgreSQL không đồng nghĩa tất cả worker đang hoạt động. Trang này hiển thị bằng chứng đã lưu, không phải health check toàn hệ thống.</p></div>
    </section>

    {query.isPending && <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3" aria-label="Đang tải số liệu">{[1, 2, 3, 4, 5].map(n => <div key={n} className="skeleton h-32" />)}</div>}
    {query.error && <div role="alert" className="panel flex items-start gap-3 border-destructive/30 p-5 text-sm text-destructive"><CircleAlert size={18} className="shrink-0" /><span>Không tải được số liệu mới. Kiểm tra kết nối hoặc quyền truy cập rồi thử lại.</span></div>}
    {query.data && <>
      {query.error && <p className="rounded-xl border border-warning/30 bg-warning/5 p-3 text-xs text-warning">Các số bên dưới là bản tải thành công trước đó ({query.data.checked_at}), không phải trạng thái hiện tại.</p>}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{cards.map(card => <article className="panel p-5" key={card.label}><div className="flex items-center justify-between gap-3"><p className="text-xs font-semibold text-muted-foreground">{card.label}</p><span className="grid h-9 w-9 place-items-center rounded-xl bg-primary/10 text-primary"><card.icon size={17} /></span></div><p className="mt-5 text-3xl font-bold tracking-tight">{card.value}</p><p className="mt-2 text-[11px] text-muted-foreground">Retained PostgreSQL V2 count</p></article>)}</div>
      <section className="panel p-5 sm:p-6"><div className="mb-5 flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-muted text-muted-foreground"><Timer size={16} /></span><h2 className="text-sm font-bold">Dấu mốc xử lý</h2></div>
        <dl className="grid gap-4 text-sm sm:grid-cols-3"><div><dt className="text-xs text-muted-foreground">Canonical gần nhất</dt><dd className="mt-1 break-words font-medium">{query.data.metrics.last_canonical_at ?? 'Chưa có dữ liệu'}</dd></div><div><dt className="text-xs text-muted-foreground">KPI gần nhất</dt><dd className="mt-1 break-words font-medium">{query.data.metrics.last_kpi_at ?? 'Chưa có dữ liệu'}</dd></div><div><dt className="text-xs text-muted-foreground">Kiểm tra lúc</dt><dd className="mt-1 break-words font-medium">{query.data.checked_at}</dd></div></dl>
        <p className="mt-5 border-t pt-4 text-xs leading-5 text-muted-foreground">Chưa đo: {query.data.unavailable.join(', ')}. Không suy ra mất dữ liệu từ chênh lệch các tổng trên.</p>
      </section>
    </>}
  </div>
}
