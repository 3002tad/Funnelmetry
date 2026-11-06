import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { apiRequest } from '../../lib/api';
import { useAuth } from '../../auth/AuthContext';
import { Button } from '../../components/ui/button';
import { Badge } from '../../components/ui/badge';
import { DesignCard } from '../../components/ui/prototype';
import { DesignDialog } from '../../components/ui/design-dialog';
type Source = {
    source_id: string;
    accepted_receipts: string;
    pending_claims: string;
    canonical_events: string;
    quarantined_outcomes: string;
    unsupported_outcomes: string;
    last_received_at: string | null;
    last_canonical_at: string | null;
    connection_status: string;
};
type Sources = {
    items: Source[];
    next_after: string | null;
    checked_at: string;
    unavailable: string[];
};
const time = (value: string | null) => value ? new Date(value).toLocaleString('vi-VN', { timeZone: 'UTC' }) : 'Chưa ghi nhận';
export default function SourcesPage() {
    const { user } = useAuth(), [search, setSearch] = useState(''), [filter, setFilter] = useState(''), [cursors, setCursors] = useState<(string | null)[]>([null]), [selected, setSelected] = useState<Source | null>(null), after = cursors[cursors.length - 1];
    const query = useQuery({ queryKey: ['admin-sources', user?.id, filter, after], queryFn: ({ signal }) => { const params = new URLSearchParams({ limit: '25' }); if (filter)
            params.set('source_id', filter); if (after)
            params.set('after', after); return apiRequest<Sources>(`/api/v2/admin/sources?${params}`, { signal }); }, retry: false, gcTime: 0 });
    const data = query.isError ? undefined : query.data, sum = (field: 'accepted_receipts' | 'canonical_events') => data ? data.items.reduce((n, s) => n + BigInt(s[field]), 0n).toString() : 'Chưa đo';
    function apply(e: FormEvent) { e.preventDefault(); setFilter(search.trim()); setCursors([null]); }
    return <div className="tpl-page sources-module"><DesignCard title="Nguồn quan sát được" action={<Badge>{data?.items.length ?? 'Chưa đo'} nguồn</Badge>}>
 <div className="tpl-source-summary"><div><small>Nguồn</small><strong className="tpl-source-name">{data?.items.length === 1 ? data.items[0].source_id : 'Nhiều nguồn'}</strong></div><div><small>Accepted receipts</small><strong>{sum('accepted_receipts')}</strong></div><div><small>Canonical retained</small><strong>{sum('canonical_events')}</strong></div></div>
 <details className="tpl-source-search-details"><summary><Search size={12}/>Lọc nguồn</summary><form onSubmit={apply} className="tpl-toolbar"><input aria-label="Lọc nguồn" maxLength={200} placeholder="source_id" value={search} onChange={e => setSearch(e.target.value)}/><Button>Tìm nguồn</Button>{filter && <Button type="button" variant="outline" onClick={() => { setSearch(''); setFilter(''); setCursors([null]); }}>Bỏ lọc</Button>}</form></details>
 {query.isError && <p role="alert">Không tải được nguồn dữ liệu. Hãy thử lại.</p>}
 <div className="tpl-table-scroll"><table><thead><tr><th>Nguồn</th><th>Kết nối</th><th>Unsupported</th><th>Gần nhất UTC</th><th /></tr></thead><tbody>{data?.items.map(s => <tr key={s.source_id}><td><strong>{s.source_id}</strong></td><td><Badge tone="warning">Chưa xác minh</Badge></td><td>{s.unsupported_outcomes}</td><td>{time(s.last_received_at)}</td><td><Button variant="outline" onClick={() => setSelected(s)}>Chi tiết</Button></td></tr>)}</tbody></table></div>
 {query.isPending && <div className="tpl-empty">Đang tải nguồn…</div>}{data && !data.items.length && <div className="tpl-empty">Chưa thấy nguồn trong phạm vi này.</div>}

 {(cursors.length > 1 || data?.next_after) && <div className="tpl-pagination"><span>Trang {cursors.length}</span><div><Button variant="outline" disabled={cursors.length === 1} onClick={() => setCursors(c => c.slice(0, -1))}>Trang trước</Button><Button variant="outline" disabled={!data?.next_after} onClick={() => setCursors(c => [...c, data!.next_after])}>Trang tiếp</Button></div></div>}
 </DesignCard>{selected && <DesignDialog title={selected.source_id} onClose={() => setSelected(null)}><table><tbody>{[['Accepted', selected.accepted_receipts], ['Canonical', selected.canonical_events], ['Unsupported', selected.unsupported_outcomes], ['Quarantined', selected.quarantined_outcomes], ['Claims chờ', selected.pending_claims], ['Kết nối nguồn', 'UNVERIFIED']].map(r => <tr key={r[0]}>{r.map(c => <td key={c}>{c}</td>)}</tr>)}</tbody></table></DesignDialog>}</div>;
}
