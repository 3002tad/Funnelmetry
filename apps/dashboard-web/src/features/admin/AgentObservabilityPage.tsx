import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { Button } from '../../components/ui/button'
import { apiRequest } from '../../lib/api'

type Snapshot = {
  status_counts: Record<'PROVISIONAL' | 'INSUFFICIENT_DATA' | 'BLOCKED_BY_QUALITY' | 'ERROR', string>
  latest_execution_at: string | null
  checked_at: string
  window_days: 30
  scope: 'PERSISTED_COMPLETED_ANALYTICAL_TOOL_EXECUTIONS_ONLY'
  read_only: true
}

const statusLabels = [
  ['PROVISIONAL', 'Kết quả tạm thời'],
  ['INSUFFICIENT_DATA', 'Thiếu dữ liệu'],
  ['BLOCKED_BY_QUALITY', 'Bị chặn bởi chất lượng'],
  ['ERROR', 'Lỗi thực thi đã lưu'],
] as const

export default function AgentObservabilityPage() {
  const { user } = useAuth()
  const query = useQuery({
    queryKey: ['admin-agent-observability', user?.id],
    queryFn: ({ signal }) => apiRequest<Snapshot>('/api/v2/admin/agent-observability', { signal }),
    retry: false, gcTime: 0,
  })
  const snapshot = query.isError ? undefined : query.data
  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Agent Observability · bằng chứng tool</h1>
        <p className="text-sm text-muted-foreground">Các execution phân tích đã lưu · chỉ đọc</p></div>
      <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Làm mới</Button>
    </header>
    <section className="panel space-y-2 p-4 text-sm">
      <p>Chỉ đếm một lần cho mỗi execution đã ghi vào bảng evidence trong 30 ngày gần đây. Đây không phải số lượt chat, tỷ lệ thành công của Agent hoặc trạng thái model.</p>
      <p>Không bao gồm câu hỏi đang chạy, gọi LLM không tạo evidence, lỗi xảy ra trước khi lưu hoặc lỗi lưu DB. Không dùng các số này để suy ra rằng hệ thống không có lỗi khác.</p>
      <p>Không hiển thị prompt, actor, payload, chi phí hay key. Chi tiết từng run được xem ở <Link className="underline" to="/admin/run-diagnostics">Analysis Run Diagnostics</Link>.</p>
    </section>
    {query.isPending && <p role="status">Đang tải bằng chứng…</p>}
    {query.isError && <p role="alert">Không đọc được evidence đã lưu. Kiểm tra quyền/API/database; không coi số liệu là 0.</p>}
    {snapshot && <>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {statusLabels.map(([status, label]) => <section className="panel p-4" key={status}>
          <h2 className="text-sm text-muted-foreground">{label}</h2>
          <p className="mt-2 text-2xl font-semibold tabular-nums">{snapshot.status_counts[status]}</p>
          <p className="text-xs text-muted-foreground">{status}</p>
        </section>)}
      </div>
      <p className="text-sm text-muted-foreground">Evidence mới nhất: {snapshot.latest_execution_at ?? 'Chưa có trong cửa sổ 30 ngày'} · Kiểm tra lúc: {snapshot.checked_at}</p>
      <p className="text-sm text-muted-foreground">PROVISIONAL là kết quả tạm thời, không phải kết quả đã được chứng nhận đầy đủ. Các trạng thái ở đây không có nhóm “thành công chính thức”.</p>
    </>}
  </div>
}
