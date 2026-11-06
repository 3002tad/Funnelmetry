import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRequest, analyticsSourceId } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { DesignCard } from '../../components/ui/prototype';
type Trace = {
    source_id: string;
    event_id: string;
    checked_at: string;
    state: string;
    receipt: {
        ingestion_id: string;
        received_at: string;
    } | null;
    outcome: {
        status: string;
        reason_code: string | null;
        mapping_version: string;
        processed_at: string;
    } | null;
    canonical: {
        canonical_event_id: string;
        event_type: string;
        event_class: string;
        occurred_at: string;
    } | null;
    journey: {
        journey_id: string;
        link_confidence: string;
        linked_at: string;
    } | null;
    funnel_applications: {
        funnel_profile_id: string;
        profile_version: string;
        application_status: string;
    }[];
    kpi_application: {
        changed_instance_count: number;
        applied_at: string;
    } | null;
};
type TrafficInput = {
    state: string;
    source_event_type: string | null;
    received_at: string | null;
    synthetic: boolean | null;
};
export default function EventTracePage({ initialSource = analyticsSourceId, initialEvent = '' }: {
    initialSource?: string;
    initialEvent?: string;
} = {}) {
    const [source, setSource] = useState(initialSource), [event, setEvent] = useState(initialEvent), [target, setTarget] = useState<{
        source: string;
        event: string;
    } | null>(initialEvent ? { source: initialSource, event: initialEvent } : null);
    const query = useQuery({ queryKey: ['admin-event-trace', target], enabled: !!target, queryFn: ({ signal }) => apiRequest<Trace>('/api/v2/admin/event-trace?' + new URLSearchParams({ source_id: target!.source, event_id: target!.event }), { signal }), retry: false });
    const traffic = useQuery({ queryKey: ['admin-traffic-source-input', target], enabled: !!target, queryFn: ({ signal }) => apiRequest<TrafficInput>('/api/v2/admin/traffic-source-input?' + new URLSearchParams({ source_id: target!.source, event_id: target!.event }), { signal }), retry: false });
    const data = query.isError ? undefined : query.data;
    const stages = data ? [
        ['Accepted receipt', data.receipt ? `${data.receipt.ingestion_id} · ${data.receipt.received_at}` : 'Chưa quan sát'],
        ['Normalization outcome', data.outcome ? `${data.outcome.status} · ${data.outcome.reason_code || 'Không có mã lỗi'} · ${data.outcome.mapping_version}` : 'Chưa quan sát'],
        ['Canonical ledger', data.canonical ? `${data.canonical.event_type} · ${data.canonical.canonical_event_id}` : 'Chưa quan sát'],
        ['Journey', data.journey ? `${data.journey.journey_id} · ${data.journey.link_confidence}` : 'Chưa quan sát'],
        ['Funnel', data.funnel_applications.map(f => `${f.funnel_profile_id}@${f.profile_version}: ${f.application_status}`).join('; ') || 'Chưa quan sát hoặc không áp dụng'],
        ['KPI', data.kpi_application ? `Đã áp dụng · ${data.kpi_application.changed_instance_count} instance thay đổi` : 'Chưa quan sát hoặc không áp dụng'],
    ] : [];
    return <DesignCard title="Event Trace" detail="Tra cứu từng event theo bằng chứng PostgreSQL đã lưu"><div className="tpl-card-body"><form className="tpl-trace-form" onSubmit={e => { e.preventDefault(); setTarget({ source: source.trim(), event: event.trim() }); }}><label>Source ID<input required maxLength={200} value={source} onChange={e => setSource(e.target.value)}/></label><label>Event ID<input required maxLength={512} value={event} onChange={e => setEvent(e.target.value)}/></label><Button disabled={!source.trim() || !event.trim() || query.isFetching}>Tra cứu</Button></form>
 {!target && <div className="tpl-empty">Nhập source_id và event ID để xem dấu vết xử lý.</div>}
 {target && query.isPending && <div className="tpl-empty">Đang tra cứu…</div>}{query.isError && <p role="alert">Không đọc được bằng chứng. Không thể kết luận event không tồn tại.</p>}
 {data && <><div className="tpl-trace-result-scope"><Badge>{data.state}</Badge><span>{data.checked_at}</span></div>{stages.map(([label, value]) => <section className="tpl-trace-step" key={label}><h3>{label}</h3><p>{value}</p></section>)}</>}
 {target && <details className="tpl-technical-details"><summary>UTM đầu vào · không phải attribution</summary>{traffic.isError ? <p role="alert">Chưa kiểm tra được dấu vết UTM.</p> : <p className="tpl-semantic-footnote">{traffic.data?.state || 'Đang kiểm tra'} · {traffic.data?.source_event_type || 'Chưa quan sát'} · {traffic.data?.received_at || 'Chưa ghi nhận'}</p>}<p className="tpl-semantic-footnote">Chỉ là dấu vết browser SDK từ Raw Kafka còn trong retention. Không hiển thị giá trị UTM; không chứng minh độ đầy đủ lịch sử.</p></details>}
 </div><p className="tpl-read-note">Không hiển thị raw payload; không replay/xóa. Không thấy một chặng không tự chứng minh event bị mất.</p></DesignCard>;
}
