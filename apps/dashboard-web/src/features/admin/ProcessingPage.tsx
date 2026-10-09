import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../../auth/AuthContext'
import { analyticsSourceId, apiRequest } from '../../lib/api'
import { Button } from '../../components/ui/button'
import MonitoringAlerts from './MonitoringAlerts'

type Stage = { stage: string; retained_count: string; last_processed_at: string | null; last_recorded_at: string | null }
type Snapshot = { source_id: string; checked_at: string; stages: Stage[] }
type WorkerSnapshot = { reason?: string; workers: { worker: string; checked_at: string; status: string; ready: boolean | null }[] }
type Lag = { checked_at: string; status: string; reason?: string; groups: {
  group_id: string; topic: string; status: string; lag_offsets: string | null;
  membership?: { status: string; state: string | null; member_count: number | null };
  partitions: { partition: number; status: string; committed_offset: string | null; high_offset: string; low_offset: string; lag_offsets: string | null }[]
}[] }
const descriptions: Record<string, [string, string]> = {
  normalized: ['Chuẩn hóa thành công', 'Kết quả mới nhất theo source event'],
  unsupported: ['Chưa hỗ trợ', 'Kết quả mới nhất theo source event'],
  quarantined: ['Đã cách ly', 'Kết quả mới nhất theo source event'],
  canonical: ['Canonical đã lưu', 'Bản ghi theo source event và phiên bản mapping'],
  kpi: ['KPI đã áp dụng', 'Lượt áp dụng projection; không phải số đơn hay số khách'],
}
const membershipLabels: Record<string, string> = {
  Stable: 'Nhóm ổn định', PreparingRebalance: 'Đang chuẩn bị phân chia lại công việc',
  CompletingRebalance: 'Đang hoàn tất phân chia lại công việc',
  Empty: 'Không có thành viên trong nhóm', Dead: 'Nhóm không còn hoạt động (Dead)',
}

export default function ProcessingPage() {
  const { user } = useAuth()
  const query = useQuery({
    queryKey: ['admin-processing', user?.id, analyticsSourceId],
    queryFn: ({ signal }) => apiRequest<Snapshot>(`/api/v2/admin/processing?source_id=${encodeURIComponent(analyticsSourceId)}`, { signal }),
    retry: false, gcTime: 0,
  })
  const snapshot = query.isError ? undefined : query.data
  const lagQuery = useQuery({
    queryKey: ['admin-kafka-lag', user?.id],
    queryFn: ({ signal }) => apiRequest<Lag>('/api/v2/admin/kafka-lag', { signal }),
    retry: false, gcTime: 0,
  })
  const lag = lagQuery.isError ? undefined : lagQuery.data
  const workerQuery = useQuery({ queryKey: ['admin-worker-readiness', user?.id],
    queryFn: ({ signal }) => apiRequest<WorkerSnapshot>('/api/v2/admin/worker-readiness', { signal }), retry: false, gcTime: 0 })
  const workers = workerQuery.isError ? undefined : workerQuery.data
  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Processing · dữ liệu đã lưu</h1>
        <p className="text-sm text-muted-foreground">Nguồn: {analyticsSourceId} · chỉ đọc</p></div>
      <Button variant="outline" disabled={query.isFetching || lagQuery.isFetching || workerQuery.isFetching} onClick={() => { void query.refetch(); void lagQuery.refetch(); void workerQuery.refetch() }}>Làm mới</Button>
    </header>
    <MonitoringAlerts />
    <section className="panel space-y-3 p-4">
      <h2 className="font-semibold">Worker · trạng thái runtime tự báo</h2>
      <p className="text-sm text-muted-foreground">Đọc từ endpoint nội bộ, cache tối đa 5 giây. READY là cờ Kafka runtime của tiến trình;
        không kiểm tra PostgreSQL liên tục, mọi replica hay bảo đảm xử lý end-to-end. UNVERIFIED không có nghĩa chắc chắn worker đã dừng.</p>
      {workerQuery.isPending && <p role="status">Đang kiểm tra worker…</p>}
      {workerQuery.isError && <p role="alert">Không đọc được trạng thái worker.</p>}
      {workers?.reason && <p>Giám sát chưa được cấu hình.</p>}
      <div className="grid gap-3 sm:grid-cols-2">{workers?.workers.map(worker => <div key={worker.worker} className="rounded border p-3">
        <p className="font-medium">{worker.worker}</p><p>{worker.status}</p>
        <p className="text-xs text-muted-foreground">Quan sát: {worker.checked_at}</p>
      </div>)}</div>
    </section>
    <section className="panel space-y-2 p-4">
      <h2 className="font-semibold">Kafka consumer lag · offset</h2>
      <p>Phạm vi: các nhóm được cấu hình trên Kafka, gồm mọi nguồn; không theo bộ lọc source hoặc thời gian. Snapshot có thể được tái sử dụng trong 5 giây.</p>
      {lagQuery.isPending && <p role="status">Đang đọc offset từ Kafka…</p>}
      {lagQuery.isError && <p role="alert">Không tải được quan sát Kafka; không coi là lag bằng 0.</p>}
      {lag && <p>Quan sát: {lag.checked_at} · {lag.status}{lag.reason ? ` · ${lag.reason}` : ''}</p>}
      {lag?.groups.map(group => <details key={`${group.group_id}/${group.topic}`} className="rounded border p-3">
        <summary className="cursor-pointer break-all">{group.group_id} · {group.topic} — {group.lag_offsets ?? 'Chưa xác minh'} offset · {group.status}
          <span className="mt-1 block text-sm">{group.membership?.status === 'OBSERVED' && group.membership.state
            ? `${membershipLabels[group.membership.state] ?? group.membership.state} · ${group.membership.member_count} thành viên`
            : 'Thành viên nhóm: chưa xác minh'}</span>
        </summary>
        <p className="mt-2 text-sm text-muted-foreground">Thành viên do broker ghi nhận cho toàn nhóm, không phải số container hay số worker riêng của topic này.
          Stable không chứng minh worker xử lý thành công. Sau khi worker mất kết nối, broker có thể cần chờ session timeout mới cập nhật.</p>
        <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-sm">
          <thead><tr><th>Partition</th><th>Low</th><th>High</th><th>Committed</th><th>Lag</th><th>Trạng thái</th></tr></thead>
          <tbody>{group.partitions.map(row => <tr key={row.partition}>
            <td>{row.partition}</td><td>{row.low_offset}</td><td>{row.high_offset}</td><td>{row.committed_offset ?? '—'}</td><td>{row.lag_offsets ?? '—'}</td><td>{row.status}</td>
          </tr>)}</tbody>
        </table></div>
      </details>)}
      <p className="text-sm text-muted-foreground">Lag là high offset trừ committed offset, không phải số event nghiệp vụ hay độ trễ thời gian.
        Các lần đọc không đồng thời; transaction/compaction có thể tạo khoảng trống. Chưa commit, offset dưới retention hoặc snapshot bất nhất sẽ không hiện số 0 thay thế.
        Lag bằng 0 không chứng minh worker còn hoạt động, nguồn đầy đủ hay xử lý end-to-end hoàn tất.</p>
      <p className="text-sm text-muted-foreground">Các số dưới đây là bản ghi còn lưu trong PostgreSQL, không theo bộ lọc thời gian phía trên.
        Không trừ các tổng để suy ra backlog hoặc mất event vì đơn vị đếm và phạm vi khác nhau.</p>
    </section>
    {query.isPending && <p role="status">Đang đọc số liệu xử lý…</p>}
    {query.isError && <p role="alert">Không đọc được số liệu. Kiểm tra API và quyền truy cập; không coi lỗi truy vấn là dữ liệu bằng 0.</p>}
    {snapshot && <>
      <p className="text-sm text-muted-foreground">Kiểm tra lúc: {snapshot.checked_at}. Thời điểm xử lý và ghi nhận là hai giá trị lớn nhất độc lập, có thể thuộc hai event khác nhau; không lấy hiệu để tính độ trễ.</p>
      <div className="grid gap-4 lg:grid-cols-2">{snapshot.stages.map(stage => <section key={stage.stage} className="panel space-y-2 p-5">
        <h2 className="font-semibold">{descriptions[stage.stage]?.[0] ?? stage.stage}</h2>
        <p className="text-3xl font-semibold">{stage.retained_count}</p>
        <p className="text-sm text-muted-foreground">{descriptions[stage.stage]?.[1]}</p>
        <p className="text-sm">Xử lý gần nhất (UTC): {stage.last_processed_at ?? 'Chưa có bản ghi'}</p>
        <p className="text-sm">Ghi nhận gần nhất (UTC): {stage.last_recorded_at ?? 'Chưa có bản ghi'}</p>
      </section>)}</div>
      <p className="text-sm">Không có bản ghi không chứng minh nguồn không phát event. Với KPI, cả hai mốc dùng applied_at; chưa có mốc telemetry riêng.</p>
      <Link to="/admin/quarantine" className="text-primary underline">Xem chi tiết Quarantine / Unsupported</Link>
    </>}
  </div>
}
