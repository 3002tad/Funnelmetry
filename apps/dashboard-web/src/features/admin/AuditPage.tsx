import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { apiRequest } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/ui/page';
import { Badge } from '../../components/ui/badge';
import { DesignCard } from '../../components/ui/prototype';
const actions = ['account.created', 'account.updated', 'account.disabled', 'password.changed', 'account.bootstrapped', 'sessions.revoked', 'preferences.updated'];
const actionLabels: Record<string,string> = {'account.created':'Tạo tài khoản','account.updated':'Cập nhật tài khoản','account.disabled':'Khóa tài khoản','password.changed':'Đổi mật khẩu','account.bootstrapped':'Khởi tạo tài khoản','sessions.revoked':'Thu hồi phiên đăng nhập','preferences.updated':'Đổi tùy chọn'};
type Audit = {
    id: string;
    actor_id: string | null;
    target_id: string | null;
    action: string;
    created_at: string;
    changes: Record<string, unknown>;
};
export default function AuditPage() {
    const { user } = useAuth(), empty = { action: '', actor_id: '', target_id: '' }, [draft, setDraft] = useState(empty), [filters, setFilters] = useState(empty), [cursors, setCursors] = useState<(string | null)[]>([null]), cursor = cursors[cursors.length - 1];
    const result = useQuery({ queryKey: ['account-audit', user?.id, filters, cursor], queryFn: ({ signal }) => { const params = new URLSearchParams({ limit: '25' }); for (const [key, value] of Object.entries(filters))
            if (value)
                params.set(key, value); if (cursor)
            params.set('cursor', cursor); return apiRequest<{
            items: Audit[];
            next_cursor: string | null;
        }>(`/api/v2/admin/audit?${params}`, { signal }); }, retry: false, gcTime: 0 });
    return <div className="tpl-page admin-readable"><PageHeader title="Audit tài khoản" description="" actions={<Button variant="outline" onClick={() => void result.refetch()}><RefreshCw size={14}/>Làm mới</Button>}/><div className="tpl-admin-scope"><Badge>Chỉ đọc</Badge></div><DesignCard title="Lịch sử thay đổi">
 <div className="tpl-toolbar"><label className="tpl-inline-field">Hành động<select aria-label="Hành động audit" value={filters.action} onChange={e => { setFilters(f => ({ ...f, action: e.target.value })); setDraft(d => ({ ...d, action: e.target.value })); setCursors([null]); }}><option value="">Tất cả</option>{actions.map(a => <option key={a} value={a}>{actionLabels[a] ?? a}</option>)}</select></label></div>
 <details className="tpl-source-search-details"><summary><span className="admin-summary-label">Lọc nâng cao</span><span className="admin-expand-hint" aria-hidden="true"><span className="admin-expand-closed">Mở chi tiết ↓</span><span className="admin-expand-open">Thu gọn ↑</span></span></summary><form className="tpl-toolbar" onSubmit={e => { e.preventDefault(); setFilters({ ...draft, actor_id: draft.actor_id.trim(), target_id: draft.target_id.trim() }); setCursors([null]); }}>{(['actor_id', 'target_id'] as const).map(field => <label className="tpl-block-label" key={field}>{field === 'actor_id' ? 'Người thực hiện (UUID)' : 'Tài khoản bị tác động (UUID)'}<input value={draft[field]} maxLength={36} pattern="[0-9a-fA-F]{8}(-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}" onChange={e => setDraft(d => ({ ...d, [field]: e.target.value }))}/></label>)}<Button>Áp dụng</Button><Button type="button" variant="outline" onClick={() => { setDraft(empty); setFilters(empty); setCursors([null]); }}>Xóa bộ lọc</Button></form></details>
 {result.isError && <p role="alert">Không tải được audit. Không coi lỗi API là lịch sử trống.</p>}
 <div className="tpl-table-scroll"><table className="admin-mobile-records"><thead><tr><th>Thời điểm UTC</th><th>Hành động</th><th>Thay đổi</th></tr></thead><tbody>{!result.isError && result.data?.items.map(row => <tr key={row.id}><td data-label="Thời điểm UTC" className="whitespace-nowrap">{new Date(row.created_at).toLocaleString('vi-VN', { timeZone: 'UTC' })}</td><td data-label="Hành động">{actionLabels[row.action] ?? row.action}</td><td data-label="Thay đổi"><details><summary><span className="admin-summary-label">{row.action === 'preferences.updated' ? 'Cập nhật tùy chọn tài khoản' : 'Xem thay đổi'}</span><span className="admin-expand-hint" aria-hidden="true"><span className="admin-expand-closed">Mở chi tiết ↓</span><span className="admin-expand-open">Thu gọn ↑</span></span></summary><dl className="tpl-audit-details"><dt>Mã hành động</dt><dd>{row.action}</dd><dt>Người thực hiện</dt><dd>{row.actor_id ?? 'Không ghi nhận'}</dd><dt>Tài khoản bị tác động</dt><dd>{row.target_id ?? 'Không ghi nhận'}</dd></dl><pre>{JSON.stringify(row.changes, null, 2)}</pre></details></td></tr>)}</tbody></table></div>
 {result.isPending && <div className="tpl-empty">Đang tải audit…</div>}{result.data && !result.data.items.length && !result.isError && <div className="tpl-empty">Chưa có bản ghi phù hợp.</div>}
 <div className="tpl-pagination"><span>Trang {cursors.length}</span><div><Button variant="outline" disabled={cursors.length === 1 || result.isFetching} onClick={() => setCursors(c => c.slice(0, -1))}>Trước</Button><Button variant="outline" disabled={!result.data?.next_cursor || result.isFetching} onClick={() => setCursors(c => [...c, result.data!.next_cursor])}>Sau</Button></div></div>
 </DesignCard></div>;
}
