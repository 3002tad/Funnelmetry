import { useState, type FormEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { DatabaseZap, Search, ShieldQuestion, RefreshCw } from 'lucide-react'
import { apiRequest, ApiError } from '../../lib/api'
import { useAuth } from '../../auth/AuthContext'
import { Button } from '../../components/ui/button'

type Source = {
  source_id: string; accepted_receipts: string; pending_claims: string; canonical_events: string
  quarantined_outcomes: string; unsupported_outcomes: string
  last_received_at: string | null; last_canonical_at: string | null; connection_status: 'UNVERIFIED'
}
type Sources = {
  items: Source[]; next_after: string | null; checked_at: string; unavailable: string[]
}
const time = (value: string | null) => value ? new Date(value).toLocaleString() : 'Chưa ghi nhận'

export default function SourcesPage() {
  const { user } = useAuth()
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('')
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const after = cursors[cursors.length - 1]
  const query = useQuery({
    queryKey: ['admin-sources', user?.id, filter, after],
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ limit: '25' })
      if (filter) params.set('source_id', filter)
      if (after) params.set('after', after)
      return apiRequest<Sources>(`/api/v2/admin/sources?${params}`, { signal })
    },
    retry: false,
    gcTime: 0,
  })
  function applyFilter(event: FormEvent) {
    event.preventDefault()
    setFilter(search.trim())
    setCursors([null])
  }

  return <div className="space-y-6">
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div><p className="eyebrow mb-2">Administration / Ingestion</p><h1 className="text-2xl font-semibold">Integrations / Sources</h1>
        <p className="mt-2 text-sm text-muted-foreground">Theo dõi các nguồn đã có dấu vết tiếp nhận và xử lý trong Pipeline.</p></div>
      <Button variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}><RefreshCw size={15} />Làm mới</Button>
    </header>
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="panel p-5"><DatabaseZap size={20} className="mb-3 text-primary" /><p className="text-sm text-muted-foreground">Nguồn trong trang hiện tại</p><p className="mt-2 text-3xl font-semibold">{query.data && !query.isError ? query.data.items.length : '—'}</p><p className="mt-2 text-xs text-muted-foreground">Tối đa 25 nguồn / trang, không phải tổng số integration.</p></div>
      <div className="panel p-5"><ShieldQuestion size={20} className="mb-3 text-warning" /><p className="font-medium">Kết nối chưa xác minh</p><p className="mt-2 text-sm leading-6 text-muted-foreground">Có event không chứng minh Relay, SDK hoặc connector đang online. Chưa có heartbeat hay probe mạng ở màn hình này.</p></div>
      <div className="panel p-5"><p className="eyebrow">Chỉ đọc · PostgreSQL V2</p><p className="mt-3 text-sm leading-6 text-muted-foreground">Số liệu tích lũy còn được lưu, không theo bộ lọc thời gian. Nguồn đã cấu hình nhưng chưa có evidence có thể không xuất hiện.</p></div>
    </div>
    <section className="panel overflow-hidden" aria-label="Danh sách nguồn">
      <form onSubmit={applyFilter} className="flex flex-wrap items-end gap-3 border-b p-4">
        <label className="min-w-0 flex-1 text-xs font-medium" htmlFor="source-search">Lọc chính xác theo source_id
          <input id="source-search" value={search} onChange={event => setSearch(event.target.value)} maxLength={200} placeholder="Ví dụ: medusa-reference" className="mt-2 block h-10 w-full rounded-lg border bg-background px-3 text-sm focus:ring-2 focus:ring-primary" /></label>
        <Button type="submit"><Search size={15} />Tìm nguồn</Button>
        {filter && <Button type="button" variant="ghost" onClick={() => { setSearch(''); setFilter(''); setCursors([null]) }}>Bỏ lọc</Button>}
      </form>
      {query.isPending && <p role="status" className="p-8 text-center text-sm text-muted-foreground">Đang đọc danh sách nguồn…</p>}
      {query.isError && <div role="alert" className="space-y-2 p-6"><p className="font-medium text-destructive">{query.error instanceof ApiError && query.error.status === 403 ? 'Tài khoản không có quyền xem integration.' : 'Không đọc được evidence nguồn dữ liệu.'}</p><p className="text-sm text-muted-foreground">Kiểm tra API, quyền truy cập hoặc schema PostgreSQL rồi bấm Làm mới. Không coi lỗi này là danh sách rỗng.</p></div>}
      {query.data && !query.isError && <>
        {!query.data.items.length ? <div className="p-10 text-center"><DatabaseZap className="mx-auto mb-3 text-muted-foreground" /><h2 className="font-medium">Chưa thấy nguồn trong phạm vi này</h2><p className="mt-2 text-sm text-muted-foreground">Kiểm tra source_id hoặc evidence tiếp nhận. Điều này không có nghĩa chưa cấu hình integration.</p></div> : <div className="overflow-x-auto"><table className="w-full text-left text-sm">
          <caption className="sr-only">Nguồn quan sát được và số liệu retained PostgreSQL V2</caption>
          <thead className="bg-muted/40 text-xs text-muted-foreground"><tr>{['Nguồn / Kết nối', 'Accepted', 'Canonical', 'Claims chờ', 'Quarantined', 'Unsupported', 'Tiếp nhận gần nhất'].map(label => <th scope="col" key={label} className="whitespace-nowrap p-4 font-medium">{label}</th>)}</tr></thead>
          <tbody>{query.data.items.map(source => <tr key={source.source_id} className="border-t align-top hover:bg-muted/20">
            <th scope="row" className="p-4 font-normal"><span className="block whitespace-nowrap font-semibold">{source.source_id}</span><span className="mt-2 inline-flex rounded-full bg-warning/10 px-2 py-1 text-[10px] text-warning">Chưa xác minh</span></th>
            {[source.accepted_receipts, source.canonical_events, source.pending_claims, source.quarantined_outcomes, source.unsupported_outcomes].map((count, i) => <td key={i} className="p-4 tabular-nums">{count}</td>)}
            <td className="whitespace-nowrap p-4 text-xs"><p>{time(source.last_received_at)}</p><p className="mt-2 text-muted-foreground">Canonical: {time(source.last_canonical_at)}</p></td>
          </tr>)}</tbody>
        </table></div>}
        <footer className="flex flex-wrap items-center justify-between gap-3 border-t p-4 text-xs text-muted-foreground"><span>Truy xuất: {time(query.data.checked_at)} · Trang {cursors.length}</span>
          <div className="flex gap-2"><Button variant="outline" size="sm" disabled={cursors.length === 1 || query.isFetching} onClick={() => setCursors(previous => previous.slice(0, -1))}>Trang trước</Button><Button variant="outline" size="sm" disabled={!query.data.next_after || query.isFetching} onClick={() => { if (query.data?.next_after) setCursors(previous => [...previous, query.data!.next_after]) }}>Trang tiếp</Button></div>
        </footer>
      </>}
    </section>
    <section className="panel p-5 text-sm"><h2 className="font-semibold">Phạm vi hiện tại</h2><p className="mt-2 leading-6 text-muted-foreground">Đây là danh mục nguồn quan sát được, chưa phải màn hình cấu hình connector. Thêm/sửa integration, quản lý key, kiểm tra Relay/Tailscale, schema/mapping và replay chưa được hỗ trợ tại đây. Không suy ra mất dữ liệu bằng cách trừ các bộ đếm.</p></section>
  </div>
}
