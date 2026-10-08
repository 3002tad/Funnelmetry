import { useQuery } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthContext'
import { apiRequest } from '../../lib/api'
import { Button } from '../../components/ui/button'

type FeedSnapshot = {
  checked_at: string; reachable: boolean; ready: boolean | null; status: string
  last_success_at: string | null
  observation: null | {
    connector_id: string; event_feed_id: string; observed_at: string
    requested_after_seq: string; retention_floor_seq: string
    latest_available_seq: string; returned_count: number
  }
}

export default function EventFeedPage() {
  const { user } = useAuth()
  const query = useQuery({
    queryKey: ['admin-event-feed', user?.id],
    queryFn: ({ signal }) => apiRequest<FeedSnapshot>('/api/v2/admin/event-feed', { signal }),
    retry: false, gcTime: 0,
  })
  const snapshot = query.isError ? undefined : query.data
  const feed = snapshot?.observation
  return <div className="space-y-5">
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-2xl font-semibold">Event Feed</h1>
        <p className="text-sm text-muted-foreground">Quan sát nguồn qua Source Connector · chỉ đọc</p></div>
      <Button variant="outline" disabled={query.isFetching} onClick={() => void query.refetch()}>Làm mới</Button>
    </header>
    <p className="panel p-4">Trang này đọc snapshot của lần poll đã được Connector xác thực;
      không gọi thêm Event Feed, không reset cursor và không điều khiển nguồn.</p>
    {query.isPending && <p role="status">Đang kiểm tra…</p>}
    {query.isError && <p role="alert">Không tải được snapshot. Kiểm tra API và quyền truy cập; không suy ra nguồn đã ngừng hoạt động.</p>}
    {snapshot && <section className="panel space-y-2 p-4">
      <h2 className="font-semibold">Trạng thái Connector</h2>
      <p>{snapshot.status} · Dashboard kiểm tra lúc: {snapshot.checked_at}</p>
      <p>Poll và bàn giao Kafka thành công gần nhất: {snapshot.last_success_at ?? 'Chưa ghi nhận'}</p>
      {!snapshot.reachable && <p>Không xác minh được endpoint giám sát. Đây không phải bằng chứng Source offline.</p>}
      <p className="text-sm text-muted-foreground">READY không chứng minh hết backlog hoặc downstream đã xử lý xong.</p>
    </section>}
    {snapshot && !feed && <p className="panel p-4">Chưa có snapshot hợp lệ. Connector có thể chưa poll thành công,
      chưa được cập nhật phiên bản hoặc endpoint giám sát chưa truy cập được. Không coi đây là feed trống.</p>}
    {feed && <section className="panel space-y-3 p-4">
      <h2 className="font-semibold">Lần phản hồi nguồn đã xác thực gần nhất</h2>
      <dl className="grid gap-3 sm:grid-cols-2">
        {[
          ['Connector', feed.connector_id], ['Feed lineage', feed.event_feed_id],
          ['Thời điểm quan sát', feed.observed_at],
          ['Cursor dùng để gửi lần poll này', feed.requested_after_seq],
          ['Retention floor (sequence)', feed.retention_floor_seq],
          ['Sequence mới nhất nguồn công bố', feed.latest_available_seq],
          ['Số record trả về trong batch', String(feed.returned_count)],
        ].map(([label, value]) => <div key={label} className="rounded-lg border p-3">
          <dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 break-all font-mono text-sm">{value}</dd>
        </div>)}
      </dl>
      <p className="text-sm text-muted-foreground">Snapshot được ghi trước khi publish batch vào Kafka, có thể đã cũ khi nguồn mất kết nối.
        Cursor trên đây không phải cursor hiện tại hay checkpoint xử lý an toàn.
        Sequence không liên tục: không lấy hiệu hai sequence làm số event còn thiếu.
        Retention floor không phải thời hạn lưu tính bằng ngày; batch rỗng không chứng minh toàn bộ lịch sử rỗng.</p>
    </section>}
  </div>
}
