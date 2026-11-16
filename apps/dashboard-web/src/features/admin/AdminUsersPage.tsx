import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { apiRequest } from '../../lib/api';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/ui/page';
import { Badge } from '../../components/ui/badge';
import { DesignCard } from '../../components/ui/prototype';
import { DesignDialog } from '../../components/ui/design-dialog';
type User = {
    id: string;
    email: string;
    display_name: string | null;
    role: string;
    is_active: boolean;
};
type Dialog = {
    kind: 'create';
} | {
    kind: 'role' | 'toggle';
    user: User;
};
export default function AdminUsersPage() {
    const { user: current } = useAuth(), cache = useQueryClient(), [dialog, setDialog] = useState<Dialog | null>(null), [role, setRole] = useState('analyst'), [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState('');
    const users = useQuery({ queryKey: ['admin-users'], queryFn: () => apiRequest<{
            users: User[];
        }>('/api/users'), retry: false }), roles = useQuery({ queryKey: ['admin-roles'], queryFn: () => apiRequest<{
            roles: {
                role: string;
                permissions: string[];
            }[];
        }>('/api/v2/admin/roles'), retry: false });
    async function save(path: string, method: string, body: object) { setBusy(true); setError(''); setMessage(''); try {
        await apiRequest(path, { method, body: JSON.stringify(body) });
        await cache.invalidateQueries({ queryKey: ['admin-users'] });
        setDialog(null);
        setMessage('Đã lưu thay đổi.');
    }
    catch (e) {
        setError(e instanceof Error ? e.message : 'Không lưu được thay đổi.');
    }
    finally {
        setBusy(false);
    } }
    function create(e: FormEvent<HTMLFormElement>) { e.preventDefault(); void save('/api/users', 'POST', Object.fromEntries(new FormData(e.currentTarget))); }
    return <div className="tpl-page admin-readable"><PageHeader title="Tài khoản & phân quyền" description="" actions={<Button variant="outline" onClick={() => { void users.refetch(); void roles.refetch(); }}><RefreshCw size={14}/>Làm mới</Button>}/>
 <DesignCard title="Danh sách tài khoản" action={<Button onClick={() => { setError(''); setDialog({ kind: 'create' }); }}>Tạo tài khoản</Button>}>
 {users.isError && <p role="alert">Không tải được tài khoản.</p>}{message && <p role="status" className="tpl-inline-message">{message}</p>}
 <div className="tpl-table-scroll"><table className="admin-mobile-records"><thead><tr><th>Tài khoản</th><th>Vai trò</th><th>Trạng thái</th><th>Thao tác</th></tr></thead><tbody>{users.data?.users.map(u => <tr key={u.id}><td data-label="Tài khoản"><strong>{u.display_name || u.email}</strong><small className="tpl-table-secondary">{u.email}</small></td><td data-label="Vai trò"><Badge>{u.role === 'super_admin' ? 'Admin' : u.role === 'analyst' ? 'Data Analyst' : u.role}</Badge></td><td data-label="Trạng thái"><Badge tone={u.is_active ? 'primary' : 'neutral'}>{u.is_active ? 'Đang hoạt động' : 'Đã khóa'}</Badge></td><td data-label="Thao tác"><div className="tpl-row"><Button variant="outline" aria-label={`Đổi vai trò ${u.email}`} disabled={busy || u.id === current?.id} onClick={() => { setRole(u.role); setError(''); setDialog({ kind: 'role', user: u }); }}>Đổi vai trò</Button><Button variant="outline" disabled={busy || u.id === current?.id} onClick={() => { setError(''); setDialog({ kind: 'toggle', user: u }); }}>{u.is_active ? 'Khóa' : 'Mở khóa'}</Button></div>{u.id === current?.id && <small className="admin-disabled-reason">Tài khoản đang đăng nhập: không tự đổi vai trò hoặc khóa.</small>}</td></tr>)}</tbody></table></div>
 {users.isPending && <div className="tpl-empty">Đang tải tài khoản…</div>}{users.data && !users.data.users.length && <div className="tpl-empty">Chưa có tài khoản.</div>}
 </DesignCard><details className="tpl-technical-details admin-role-details"><summary>Quyền theo vai trò <span className="admin-expand-hint">Xem / thu gọn ↕</span></summary><div className="tpl-grid tpl-equal">{[{ id: 'super_admin', title: 'Admin', subtitle: 'Quản trị kỹ thuật', detail: 'Không tự cấp quyền phân tích nghiệp vụ hoặc truy cập chat Analyst.' }, { id: 'analyst', title: 'Data Analyst', subtitle: 'Phân tích nghiệp vụ', detail: 'Không có quyền vận hành kỹ thuật hoặc quản trị tài khoản.' }].map(r => <DesignCard key={r.id} title={r.title} detail={r.subtitle}><div className="tpl-card-body tpl-role-caption">{roles.isError ? 'Không tải được quyền theo vai trò.' : roles.data?.roles.find(v => v.role === r.id)?.permissions.join(' · ')}<p>{r.detail}</p></div></DesignCard>)}</div></details>
 {dialog && <DesignDialog title={dialog.kind === 'create' ? 'Tạo tài khoản' : dialog.kind === 'role' ? 'Đổi vai trò' : 'Xác nhận thay đổi tài khoản'} onClose={() => { if (!busy)
            setDialog(null); }}>{error && <p role="alert">{error}</p>}
 {dialog.kind === 'create' ? <form onSubmit={create}><div className="tpl-admin-form"><label>Tên hiển thị<input name="display_name" required maxLength={100}/></label><label>Email<input name="email" type="email" required autoComplete="off"/></label><label>Mật khẩu ban đầu<small>Tối thiểu 8 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt.</small><input name="password" type="password" required minLength={8} pattern={"(?=.*[A-Z])(?=.*[a-z])(?=.*[0-9])(?=.*[^\\p{L}\\p{N}\\s]).{8,}"} title="Tối thiểu 8 ký tự, gồm chữ hoa, chữ thường, số và ký tự đặc biệt." autoComplete="new-password"/></label><label>Vai trò<select name="role" defaultValue="analyst"><option value="analyst">Data Analyst</option><option value="super_admin">Admin</option></select></label></div><div className="tpl-form-foot"><Button type="button" variant="outline" disabled={busy} onClick={() => setDialog(null)}>Hủy</Button><Button disabled={busy}>Tạo tài khoản</Button></div></form> : <><p className="tpl-semantic-footnote">{dialog.user.email}</p>{dialog.kind === 'role' ? <label className="tpl-block-label">Vai trò<select value={role} onChange={e => setRole(e.target.value)}><option value="analyst">Data Analyst</option><option value="super_admin">Admin</option></select></label> : <p>{dialog.user.is_active ? 'Khóa' : 'Mở khóa'} tài khoản này?</p>}<div className="tpl-form-foot"><Button variant="outline" disabled={busy} onClick={() => setDialog(null)}>Hủy</Button><Button disabled={busy} onClick={() => void save(`/api/users/${dialog.user.id}`, 'PATCH', dialog.kind === 'role' ? { role } : { is_active: !dialog.user.is_active })}>Xác nhận</Button></div></>}
 </DesignDialog>}
 </div>;
}
