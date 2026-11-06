import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { apiRequest, analyticsSourceId } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { DesignCard } from '../../components/ui/prototype';
type Outcome = {
    source_id: string;
    source_event_id: string;
    mapping_version: string;
    status: string;
    reason_code: string;
    processed_at: string;
};
export default function QuarantinePage({ onTrace }: {
    onTrace?: (source: string, event: string) => void;
}) {
    const { user } = useAuth(), [draft, setDraft] = useState(analyticsSourceId), [source, setSource] = useState(analyticsSourceId), [status, setStatus] = useState(''), [search, setSearch] = useState(''), [offset, setOffset] = useState(0);
    const query = useQuery({ queryKey: ['quarantine', user?.id, source, status, offset], queryFn: ({ signal }) => { const params = new URLSearchParams({ source_id: source, offset: String(offset) }); if (status)
            params.set('status', status); return apiRequest<{
            items: Outcome[];
            next_offset: number | null;
            checked_at: string;
        }>(`/api/v2/admin/quarantine?${params}`, { signal }); }, retry: false, gcTime: 0 });
    const data = query.isError ? undefined : query.data, rows = data?.items.filter(r => [r.source_event_id, r.reason_code, r.mapping_version].some(v => v.toLowerCase().includes(search.toLowerCase()))) ?? [];
    return <DesignCard title="Sự kiện cần kiểm tra" action={<Badge tone="warning">{data?.items.length ?? 'Chưa đo'} trong trang</Badge>}>
 <div className="tpl-toolbar"><label className="tpl-search-wrap"><Search size={14}/><input aria-label="Tìm sự kiện cần kiểm tra" placeholder="Tìm event / lý do / mapping…" value={search} onChange={e => setSearch(e.target.value)}/></label><select aria-label="Trạng thái chuẩn hóa" value={status} onChange={e => { setStatus(e.target.value); setOffset(0); }}><option value="">Tất cả trạng thái</option><option value="unsupported">Unsupported</option><option value="quarantined">Quarantined</option></select></div>
 <details className="tpl-source-search-details"><summary>Nguồn dữ liệu: {source}</summary><form className="tpl-toolbar" onSubmit={e => { e.preventDefault(); setSource(draft.trim()); setOffset(0); }}><input aria-label="Nguồn kiểm tra" value={draft} required maxLength={200} onChange={e => setDraft(e.target.value)}/><Button>Áp dụng</Button></form></details>
 {query.isError && <p role="alert">Không đọc được sự kiện cần kiểm tra. Không thể kết luận không có event lỗi.</p>}
 <div className="tpl-table-scroll"><table><thead><tr><th>Event</th><th>Trạng thái</th><th>Lý do</th><th>Mapping</th><th /></tr></thead><tbody>{rows.map(r => <tr key={r.source_event_id}><td title={r.source_event_id} className="mono">{r.source_event_id.length > 32 ? r.source_event_id.slice(0, 20) + '…' + r.source_event_id.slice(-4) : r.source_event_id}</td><td><Badge tone="warning">{r.status}</Badge></td><td>{r.reason_code}</td><td>{r.mapping_version}</td><td>{onTrace ? <Button variant="outline" onClick={() => onTrace(r.source_id, r.source_event_id)}>Trace</Button> : <span>{r.processed_at}</span>}</td></tr>)}</tbody></table></div>
 {!query.isFetching && !query.isError && !rows.length && <div className="tpl-empty">Không có kết quả phù hợp trong trang hiện tại.</div>}

 {(offset > 0 || data?.next_offset != null) && <div className="tpl-pagination"><span>Trang {offset / 25 + 1}</span><div><Button variant="outline" disabled={!offset} onClick={() => setOffset(n => Math.max(0, n - 25))}>Trước</Button><Button variant="outline" disabled={data?.next_offset == null} onClick={() => setOffset(data!.next_offset!)}>Sau</Button></div></div>}
 </DesignCard>;
}
