import { useQuery } from '@tanstack/react-query'
import { apiRequest, analyticsSourceId } from '../../lib/api'
import { Button } from '../../components/ui/button'

type Health = { source_id: string; checked_at: string; runtime_status: string;
  metrics: { accepted: number; terminal: number; canonical: number; kpi_applications: number;
    pending_claims: number; last_canonical_at: string | null; last_kpi_at: string | null }; unavailable: string[] }

export default function PipelineHealthPage() {
  const query = useQuery({ queryKey: ['admin-pipeline', analyticsSourceId],
    queryFn: () => apiRequest<Health>(`/api/v2/admin/pipeline?source_id=${encodeURIComponent(analyticsSourceId)}`),
    refetchInterval: 15000 })
  return <div className="space-y-6">
    <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Pipeline Health</h1>
      <Button onClick={() => void query.refetch()} disabled={query.isFetching}>Làm mới</Button></div>
    <p className="text-sm text-muted-foreground">Nguồn: {analyticsSourceId}. Số liệu tích lũy còn lưu trong PostgreSQL V2, không theo bộ lọc thời gian phía trên.</p>
    <div className="panel p-4 text-sm">Trạng thái runtime: <strong>Chưa xác minh</strong>. Có dữ liệu không đồng nghĩa tất cả worker đang hoạt động.</div>
    {query.isPending && <p>Đang tải…</p>}
    {query.error && <p role="alert" className="text-destructive">Không đọc được số liệu V2: {query.error.message}</p>}
    {query.data && <>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[
        ['Accepted receipts', query.data.metrics.accepted], ['Terminal outcomes', query.data.metrics.terminal],
        ['Canonical events', query.data.metrics.canonical], ['KPI applications', query.data.metrics.kpi_applications],
        ['Claims đang chờ', query.data.metrics.pending_claims],
      ].map(([label, value]) => <div className="panel p-5" key={label}><p className="text-sm text-muted-foreground">{label}</p><p className="mt-2 text-3xl font-semibold">{value}</p></div>)}</div>
      <section className="panel space-y-3 p-5 text-sm"><h2 className="font-semibold">Dấu mốc xử lý</h2>
        <p>Canonical gần nhất: {query.data.metrics.last_canonical_at ?? 'Chưa có dữ liệu'}</p>
        <p>KPI gần nhất: {query.data.metrics.last_kpi_at ?? 'Chưa có dữ liệu'}</p>
        <p>Kiểm tra lúc: {query.data.checked_at}</p>
        <p className="text-muted-foreground">Chưa đo: {query.data.unavailable.join(', ')}. Không suy ra mất dữ liệu từ chênh lệch các tổng trên.</p></section>
    </>}
  </div>
}
