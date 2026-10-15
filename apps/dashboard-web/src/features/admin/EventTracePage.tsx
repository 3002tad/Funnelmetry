import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { apiRequest, analyticsSourceId } from '../../lib/api'
import { Button } from '../../components/ui/button'
import { PageHeader } from '../../components/ui/page'

type Trace = {
  source_id: string; event_id: string; checked_at: string; state: string
  receipt: { ingestion_id: string; received_at: string } | null
  outcome: { status: string; reason_code: string | null; mapping_version: string; processed_at: string } | null
  canonical: { canonical_event_id: string; event_type: string; event_class: string; occurred_at: string } | null
  journey: { journey_id: string; link_confidence: string; linked_at: string } | null
  funnel_applications: { funnel_profile_id: string; profile_version: string; application_status: string }[]
  kpi_application: { changed_instance_count: number; applied_at: string } | null
}

type TrafficInput = {
  source_id: string; event_id: string; checked_at: string
  state: 'PRESENT' | 'ABSENT' | 'INVALID' | 'NOT_OBSERVED'
  source_event_type: string | null; received_at: string | null; synthetic: boolean | null
  attribution_verified: false; historical_coverage_verified: false
}

export default function EventTracePage() {
  const [sourceDraft, setSourceDraft] = useState(analyticsSourceId)
  const [eventDraft, setEventDraft] = useState('')
  const [target, setTarget] = useState<{ source: string; event: string } | null>(null)
  const result = useQuery({ queryKey: ['admin-event-trace', target], enabled: target !== null,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ source_id: target!.source, event_id: target!.event })
      return apiRequest<Trace>(`/api/v2/admin/event-trace?${params}`, { signal })
    }, retry: false })
  const trafficInput = useQuery({ queryKey: ['admin-traffic-source-input', target], enabled: target !== null,
    queryFn: ({ signal }) => {
      const params = new URLSearchParams({ source_id: target!.source, event_id: target!.event })
      return apiRequest<TrafficInput>(`/api/v2/admin/traffic-source-input?${params}`, { signal })
    }, retry: false })

  return <div className="space-y-5">
    <PageHeader title="Event Trace" description="Tra cứu từng event theo ID trên bằng chứng PostgreSQL đã lưu" />
    <p className="panel p-4 text-sm">Tra cứu một event theo ID trên dữ liệu PostgreSQL còn lưu. Không hiển thị raw payload; không gửi lại event hoặc điều khiển worker. Không thấy một chặng có thể do xử lý đang chờ, không tự chứng minh event bị mất.</p>
    <form className="panel flex flex-wrap items-end gap-3 p-4" onSubmit={event => {
      event.preventDefault(); setTarget({ source: sourceDraft.trim(), event: eventDraft.trim() })
    }}>
      <label className="text-sm">Source ID<input required maxLength={200} value={sourceDraft} onChange={event => setSourceDraft(event.target.value)} className="mt-1 block rounded border bg-background p-2" /></label>
      <label className="min-w-[280px] flex-1 text-sm">Event ID<input required maxLength={512} value={eventDraft} onChange={event => setEventDraft(event.target.value)} className="mt-1 block w-full rounded border bg-background p-2" /></label>
      <Button type="submit" disabled={!sourceDraft.trim() || !eventDraft.trim()}>Tra cứu</Button>
      <Button type="button" variant="outline" disabled={!target || result.isFetching || trafficInput.isFetching} onClick={() => {
        void result.refetch(); void trafficInput.refetch()
      }}>Làm mới</Button>
    </form>
    {result.isPending && target && <p role="status">Đang tra cứu…</p>}
    {result.isError && <p role="alert" className="text-destructive">Không đọc được bằng chứng lúc này; không thể kết luận event không tồn tại.</p>}
    {result.data && !result.isError && <section className="panel space-y-4 p-5 text-sm">
      <div><p className="font-semibold">{result.data.state}</p><p className="break-all text-muted-foreground">{result.data.source_id} · {result.data.event_id}</p><p>Kiểm tra lúc: {result.data.checked_at}</p></div>
      <ol className="space-y-3">
        <li><strong>1. Accepted receipt:</strong> {result.data.receipt ? `${result.data.receipt.ingestion_id} · ${result.data.receipt.received_at}` : 'Chưa quan sát'}</li>
        <li><strong>2. Canonicalization:</strong> {result.data.outcome ? `${result.data.outcome.status} · mapping ${result.data.outcome.mapping_version} · ${result.data.outcome.reason_code ?? 'không có mã lỗi'}` : 'Chưa quan sát'}</li>
        <li><strong>3. Canonical ledger:</strong> {result.data.canonical ? `${result.data.canonical.event_type} (${result.data.canonical.event_class}) · ${result.data.canonical.canonical_event_id}` : 'Chưa quan sát'}</li>
        <li><strong>4. Journey:</strong> {result.data.journey ? `${result.data.journey.journey_id} · ${result.data.journey.link_confidence}` : 'Chưa quan sát'}</li>
        <li><strong>5. Funnel:</strong> {result.data.funnel_applications.length ? result.data.funnel_applications.map(item => `${item.funnel_profile_id}@${item.profile_version}: ${item.application_status}`).join('; ') : 'Chưa quan sát hoặc không áp dụng'}</li>
        <li><strong>6. KPI:</strong> {result.data.kpi_application ? `Đã áp dụng · ${result.data.kpi_application.changed_instance_count} instance thay đổi` : 'Chưa quan sát hoặc không áp dụng'}</li>
      </ol>
      <p className="border-t pt-3 text-muted-foreground">Chỉ xác nhận dữ liệu PostgreSQL. Source Feed record, Kafka ACK, processing-safe checkpoint và độ đầy đủ dữ liệu cần bằng chứng riêng. Cursor không phải checkpoint xử lý an toàn.</p>
    </section>}
    {target && <section className="panel space-y-2 p-5 text-sm">
      <h2 className="font-semibold">UTM đầu vào — không phải attribution</h2>
      {trafficInput.isPending && <p role="status">Đang kiểm tra dấu vết UTM…</p>}
      {trafficInput.isError && <p role="alert">Chưa kiểm tra được bảng UTM đầu vào. Không thể kết luận event không có UTM.</p>}
      {trafficInput.data && !trafficInput.isError && <>
        <p>Trạng thái: {trafficInput.data.state === 'PRESENT' ? 'Có utm_source dạng chuỗi'
          : trafficInput.data.state === 'ABSENT' ? 'Event không mang utm_source'
            : trafficInput.data.state === 'INVALID' ? 'utm_source không đúng dạng chuỗi'
              : 'Chưa quan sát thấy bản ghi phù hợp'}</p>
        {trafficInput.data.source_event_type && <p>Loại event nguồn: {trafficInput.data.source_event_type}</p>}
        {trafficInput.data.received_at && <p>Nhận lúc: {trafficInput.data.received_at}</p>}
        {trafficInput.data.synthetic !== null && <p>Synthetic: {trafficInput.data.synthetic ? 'Có' : 'Không'}</p>}
      </>}
      <p className="text-muted-foreground">Chỉ là dấu vết event browser SDK từ Raw Kafka còn trong retention. Không hiển thị giá trị UTM hoặc hash; chưa chứng minh phân kênh, chiến dịch hay độ đầy đủ lịch sử. Một event không có hàng cũng có thể là event backend hoặc worker chưa xử lý.</p>
    </section>}
  </div>
}
