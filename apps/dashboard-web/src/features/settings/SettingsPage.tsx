import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Moon, Sun, Settings2, RefreshCw } from 'lucide-react';
import { useOutletContext } from 'react-router-dom';
import type { ShellContext } from '../../app/AppShell';
import { useAuth } from '../../auth/AuthContext';
import { apiRequest } from '../../lib/api';
import { accountPreferencesKey, type PreferencesResponse } from '../../lib/account-preferences';
import { Button } from '../../components/ui/button';
import { PageHeader } from '../../components/ui/page';
import { DesignCard } from '../../components/ui/prototype';
import { DesignDialog } from '../../components/ui/design-dialog';
type Activity = {
    items: {
        id: string;
        action: string;
        created_at: string;
    }[];
    next_cursor: string | null;
};
export function SettingsPage() {
    const { user, logout } = useAuth(), { workspace, sourceId, setThemePreference } = useOutletContext<ShellContext>(), cache = useQueryClient();
    const [tab, setTab] = useState('profile'), [name, setName] = useState(user?.display_name || ''), [passwordOpen, setPasswordOpen] = useState(false), [showPassword, setShowPassword] = useState(false), [current, setCurrent] = useState(''), [next, setNext] = useState(''), [confirmation, setConfirmation] = useState(''), [busy, setBusy] = useState(false), [nameMessage, setNameMessage] = useState(''), [passwordMessage, setPasswordMessage] = useState(''), [preferenceMessage, setPreferenceMessage] = useState(''), [error, setError] = useState(''), [cursors, setCursors] = useState<(string | null)[]>([null]);
    const prefs = useQuery({ queryKey: accountPreferencesKey(user?.id), queryFn: ({ signal }) => apiRequest<PreferencesResponse>('/api/account/preferences', { signal }), retry: false });
    const cursor = cursors[cursors.length - 1];
    const activity = useQuery({ queryKey: ['account-activity', user?.id, cursor], enabled: tab === 'activity', queryFn: ({ signal }) => apiRequest<Activity>('/api/account/activity?limit=10' + (cursor ? '&cursor=' + encodeURIComponent(cursor) : ''), { signal }), retry: false });
    useEffect(() => setName(user?.display_name || ''), [user?.display_name]);
    async function saveName(e: FormEvent) { e.preventDefault(); setBusy(true); setNameMessage(''); setError(''); try {
        await apiRequest('/api/account/profile', { method: 'PATCH', body: JSON.stringify({ display_name: name.trim() }) });
        window.dispatchEvent(new Event('funnelmetry:profile-updated'));
        setNameMessage('Đã lưu tên hiển thị.');
    }
    catch {
        setError('Không lưu được tên hiển thị. Kiểm tra API và phiên đăng nhập.');
    }
    finally {
        setBusy(false);
    } }
    async function changePassword(e: FormEvent) { e.preventDefault(); setPasswordMessage(''); if (next !== confirmation) {
        setPasswordMessage('Mật khẩu nhập lại chưa khớp.');
        return;
    } if (next === current) {
        setPasswordMessage('Mật khẩu mới cần khác mật khẩu hiện tại.');
        return;
    } setBusy(true); try {
        await apiRequest('/api/auth/change-password', { method: 'PATCH', body: JSON.stringify({ current_password: current, new_password: next }) });
        setCurrent('');
        setNext('');
        setConfirmation('');
        setPasswordMessage('Đã đổi mật khẩu. Bạn sẽ được đăng xuất để đăng nhập lại.');
        setTimeout(logout, 1200);
    }
    catch (e) {
        setPasswordMessage(e instanceof Error ? e.message : 'Không đổi được mật khẩu.');
    }
    finally {
        setBusy(false);
    } }
    async function setLanguage(language: 'vi' | 'en') { setPreferenceMessage(''); try {
        const saved = await apiRequest<PreferencesResponse>('/api/account/preferences', { method: 'PATCH', body: JSON.stringify({ language }) });
        cache.setQueryData(accountPreferencesKey(user?.id), saved);
        setPreferenceMessage('Đã lưu ngôn ngữ. Các nhãn chưa có bản dịch giữ nội dung gốc.');
    }
    catch {
        setPreferenceMessage('Không lưu được ngôn ngữ.');
    } }
    if (user?.role === 'super_admin')
        return <div className="tpl-page"><PageHeader title="Thiết lập cá nhân" description="Quản trị nguồn, xử lý và quyền truy cập hệ thống."/><div className="tpl-admin-scope"><span>medusa-reference</span></div><DesignCard title="Thiết lập cá nhân"><form className="tpl-card-body admin-profile-form" onSubmit={saveName}><div className="tpl-field"><label htmlFor="admin-profile-name">Tên hiển thị</label><input id="admin-profile-name" aria-label="Tên hiển thị" value={name} required maxLength={100} onChange={e => setName(e.target.value)}/></div><div className="tpl-field"><label>Email</label><span>{user.email}</span></div><div className="tpl-field"><label>Giao diện</label><div className="tpl-row"><Button type="button" variant="outline" onClick={() => void setThemePreference('light')}><Sun size={15}/>Sáng</Button><Button type="button" variant="outline" onClick={() => void setThemePreference('dark')}><Moon size={15}/>Tối</Button></div></div><div className="tpl-row"><Button disabled={busy || !name.trim()}>Lưu tên hiển thị</Button><Button type="button" variant="ghost" onClick={() => setPasswordOpen(true)}>Thay đổi mật khẩu</Button></div>{nameMessage && <p role="status" className="tpl-form-message">{nameMessage}</p>}{error && <p role="alert">{error}</p>}</form></DesignCard>{passwordOpen && <DesignDialog title="Đổi mật khẩu" onClose={() => { if (!busy)
            setPasswordOpen(false); }}><form onSubmit={changePassword}><div className="tpl-field"><label htmlFor="admin-current-password">Mật khẩu hiện tại</label><input id="admin-current-password" aria-label="Current password" type="password" autoComplete="current-password" required value={current} onChange={e => setCurrent(e.target.value)}/></div><div className="tpl-field"><label htmlFor="admin-new-password">Mật khẩu mới</label><input id="admin-new-password" aria-label="New password" type="password" autoComplete="new-password" minLength={12} required value={next} onChange={e => setNext(e.target.value)}/></div><div className="tpl-field"><label htmlFor="admin-confirm-password">Nhập lại mật khẩu</label><input id="admin-confirm-password" aria-label="Confirm password" type="password" autoComplete="new-password" minLength={12} required value={confirmation} onChange={e => setConfirmation(e.target.value)}/></div><div className="tpl-form-foot"><Button type="button" variant="outline" disabled={busy} onClick={() => { setPasswordOpen(false); setCurrent(''); setNext(''); setConfirmation(''); }}>Hủy</Button><Button disabled={busy}>Đổi mật khẩu</Button></div>{passwordMessage && <p role="status">{passwordMessage}</p>}</form></DesignDialog>}</div>;
    return <div className="tpl-page settings-page"><PageHeader title="Thiết lập cá nhân" description="Quản lý hồ sơ, bảo mật và tùy chọn cá nhân."/>
 <div className="tpl-settings-grid"><nav className="tpl-settings-menu" aria-label="Thiết lập tài khoản">{[['profile', 'Hồ sơ & bảo mật'], ['workspace', 'Workspace'], ['activity', 'Lịch sử tài khoản']].map(([id, label]) => <button key={id} className={tab === id ? "tpl-selected" : ""} onClick={() => setTab(id)}>{label}</button>)}</nav><div className="tpl-settings-content">
 {tab === 'profile' && <>
 <DesignCard title="Hồ sơ cá nhân"><form className="tpl-card-body" onSubmit={saveName}><div className="tpl-field"><label htmlFor="profile-name">Tên hiển thị<small>Hiển thị trên thanh tài khoản</small></label><input id="profile-name" aria-label="Tên hiển thị" required maxLength={100} autoComplete="nickname" value={name} onChange={e => setName(e.target.value)}/></div><div className="tpl-field"><label>Email<small>Địa chỉ đăng nhập tài khoản</small></label><span>{user?.email}</span></div><Button disabled={busy || !name.trim()}>Lưu tên hiển thị</Button>{nameMessage && <p className="tpl-form-message" role="status">{nameMessage}</p>}{error && <p role="alert">{error}</p>}</form></DesignCard>
 <DesignCard title="Đổi mật khẩu"><div className="tpl-card-body">{!passwordOpen ? <Button variant="outline" onClick={() => setPasswordOpen(true)}><Settings2 size={15}/>Thay đổi mật khẩu</Button> : <form onSubmit={changePassword}>
 <div className="tpl-field"><label htmlFor="current-password">Mật khẩu hiện tại</label><input id="current-password" aria-label="Current password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" required value={current} onChange={e => setCurrent(e.target.value)}/></div>
 <div className="tpl-field"><label htmlFor="new-password">Mật khẩu mới<small>Ít nhất 12 ký tự</small></label><input id="new-password" aria-label="New password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} required value={next} onChange={e => setNext(e.target.value)}/></div>
 <div className="tpl-field"><label htmlFor="confirm-password">Nhập lại mật khẩu mới</label><input id="confirm-password" aria-label="Confirm password" type={showPassword ? 'text' : 'password'} autoComplete="new-password" minLength={12} required value={confirmation} onChange={e => setConfirmation(e.target.value)}/></div>
 <label className="tpl-show-password"><input type="checkbox" checked={showPassword} onChange={e => setShowPassword(e.target.checked)}/>Hiện mật khẩu</label><div className="tpl-row"><Button disabled={busy}>Đổi mật khẩu</Button><Button type="button" variant="outline" disabled={busy} onClick={() => { setPasswordOpen(false); setCurrent(''); setNext(''); setConfirmation(''); setPasswordMessage(''); }}>Hủy</Button></div>{passwordMessage && <p className="tpl-form-message" role="status">{passwordMessage}</p>}
 </form>}</div></DesignCard>
 <DesignCard title="Ngôn ngữ"><div className="tpl-card-body"><label htmlFor="profile-language" className="tpl-small tpl-muted">Ngôn ngữ</label><select id="profile-language" className="tpl-full-width" value={prefs.data?.preferences.language || 'vi'} disabled={!prefs.data} onChange={e => void setLanguage(e.target.value as 'vi' | 'en')}><option value="vi">Tiếng Việt</option><option value="en">English</option></select>{preferenceMessage && <p className="tpl-form-message" role="status">{preferenceMessage}</p>}</div></DesignCard>
 <DesignCard title="Giao diện"><div className="tpl-card-body tpl-row"><Button variant="outline" onClick={() => void setThemePreference('light')}><Sun size={15}/>Sáng</Button><Button variant="outline" onClick={() => void setThemePreference('dark')}><Moon size={15}/>Tối</Button></div></DesignCard>
 </>}
 {tab === 'workspace' && <DesignCard title="Workspace"><div className="tpl-card-body"><div className="tpl-field"><label>Workspace</label><span>{workspace}</span></div><div className="tpl-field"><label>Nguồn dữ liệu</label><span>{sourceId}</span></div><div className="tpl-field"><label>Vai trò</label><span>{user?.role === 'super_admin' ? 'Admin' : 'Data Analyst'}</span></div><Button variant="outline" disabled={busy} onClick={async () => { setBusy(true); try {
        await apiRequest('/api/auth/logout-all', { method: 'POST' });
        logout();
    }
    catch {
        setError('Không thu hồi được phiên đăng nhập.');
    }
    finally {
        setBusy(false);
    } }}>Đăng xuất trên mọi thiết bị</Button>{error && <p role="alert">{error}</p>}</div></DesignCard>}
 {tab === 'activity' && <DesignCard title="Lịch sử tài khoản" action={<Button variant="ghost" onClick={() => void activity.refetch()}><RefreshCw size={14}/></Button>}>{activity.isError ? <p role="alert">Không đọc được lịch sử tài khoản.</p> : <><table><thead><tr><th>Thời điểm UTC</th><th>Thao tác</th></tr></thead><tbody>{activity.data?.items.map(r => <tr key={r.id}><td>{r.created_at}</td><td>{r.action}</td></tr>)}</tbody></table><div className="tpl-pagination"><span>Trang {cursors.length}</span><div><Button variant="outline" disabled={cursors.length === 1} onClick={() => setCursors(c => c.slice(0, -1))}>Trước</Button><Button variant="outline" disabled={!activity.data?.next_cursor} onClick={() => setCursors(c => [...c, activity.data!.next_cursor])}>Sau</Button></div></div></>}</DesignCard>}
 </div></div></div>;
}
