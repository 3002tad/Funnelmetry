import { useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '../../auth/AuthContext'
import { apiRequest } from '../../lib/api'
import { Button } from '../../components/ui/button'

type User = { id: string; email: string; display_name: string | null; role: string; is_active: boolean }
type Roles = { roles: { role: string; permissions: string[] }[] }

export default function AdminUsersPage() {
  const { user: current } = useAuth()
  const cache = useQueryClient()
  const users = useQuery({ queryKey: ['admin-users'], queryFn: () => apiRequest<{ users: User[] }>('/api/users') })
  const roles = useQuery({ queryKey: ['admin-roles'], queryFn: () => apiRequest<Roles>('/api/v2/admin/roles') })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  async function save(path: string, method: string, body: object) {
    setBusy(true); setError(''); setMessage('')
    try {
      await apiRequest(path, { method, body: JSON.stringify(body) })
      await cache.invalidateQueries({ queryKey: ['admin-users'] })
      setMessage('Đã lưu thay đổi.')
      return true
    } catch (err) { setError(err instanceof Error ? err.message : 'Không lưu được'); return false }
    finally { setBusy(false) }
  }
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const data = new FormData(form)
    if (await save('/api/users', 'POST', Object.fromEntries(data))) form.reset()
  }
  return <div className="space-y-6">
    <h1 className="text-2xl font-semibold">Users / Roles</h1>
    <p className="text-sm text-muted-foreground">Hai nhóm quyền ban đầu. Admin quản trị kỹ thuật, không tự có quyền phân tích hoặc quyết định kinh doanh. Chưa hỗ trợ tự định nghĩa role.</p>
    {(error || users.error || roles.error) && <p role="alert" className="text-destructive">{error || users.error?.message || roles.error?.message}</p>}
    {message && <p role="status">{message}</p>}
    <section className="panel p-5"><h2 className="mb-3 font-semibold">Tạo tài khoản</h2>
      <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">Email<input name="email" type="email" required className="mt-1 w-full rounded border bg-background p-2" /></label>
        <label className="text-sm">Tên hiển thị<input name="display_name" className="mt-1 w-full rounded border bg-background p-2" /></label>
        <label className="text-sm">Mật khẩu ban đầu<input name="password" type="password" minLength={12} required autoComplete="new-password" className="mt-1 w-full rounded border bg-background p-2" /></label>
        <label className="text-sm">Vai trò<select name="role" defaultValue="analyst" className="mt-1 w-full rounded border bg-background p-2"><option value="analyst">Analyst</option><option value="super_admin">System Admin</option></select></label>
        <Button disabled={busy}>Tạo tài khoản</Button>
      </form></section>
    <section className="panel overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr><th className="p-4">Tài khoản</th><th>Vai trò</th><th>Trạng thái</th><th>Thao tác</th></tr></thead>
      <tbody>{users.data?.users.map(user => <tr key={user.id} className="border-t"><td className="p-4">{user.email}<p className="text-xs text-muted-foreground">{user.display_name}</p></td>
        <td><select aria-label={`Vai trò ${user.email}`} value={user.role} disabled={busy || user.id === current?.id} className="rounded border bg-background p-2"
          onChange={event => { const role = event.target.value; if (window.confirm(`Đổi vai trò của ${user.email}?`)) void save(`/api/users/${user.id}`, 'PATCH', { role }) }}>
          {user.role === 'viewer' && <option value="viewer">Viewer (legacy)</option>}<option value="analyst">Analyst</option><option value="super_admin">System Admin</option></select></td>
        <td>{user.is_active ? 'Đang hoạt động' : 'Đã khóa'}</td><td><Button variant="outline" disabled={busy || user.id === current?.id}
          onClick={() => { if (window.confirm(`${user.is_active ? 'Khóa' : 'Mở khóa'} ${user.email}?`)) void save(`/api/users/${user.id}`, 'PATCH', { is_active: !user.is_active }) }}>{user.is_active ? 'Khóa' : 'Mở khóa'}</Button></td></tr>)}</tbody></table>
      {users.isPending && <p className="p-4">Đang tải…</p>}
      {users.data?.users.length === 0 && <p className="p-4">Chưa có tài khoản.</p>}</section>
    <section className="panel p-5"><h2 className="mb-3 font-semibold">Quyền theo vai trò</h2>{roles.data?.roles.map(role => <p className="my-2 text-sm" key={role.role}><strong>{role.role}</strong>: {role.permissions.join(', ')}</p>)}</section>
  </div>
}
