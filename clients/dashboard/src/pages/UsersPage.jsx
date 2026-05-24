import { useCallback, useState } from "react";
import { PageHeader } from "../components/PageHeader.jsx";
import { api } from "../lib/api.js";
import { ROLE_LABELS } from "../lib/auth.js";
import { useAutoRefresh } from "../hooks/useAutoRefresh.js";

const ROLES = ["super_admin", "analyst", "viewer"];

export function UsersPage() {
  const fetcher = useCallback(() => api.users(), []);
  const { data, loading, error, refresh } = useAutoRefresh(fetcher, 0);
  const [form, setForm] = useState({ email: "", password: "", display_name: "", role: "viewer" });
  const [msg, setMsg] = useState("");

  async function handleCreate(e) {
    e.preventDefault();
    setMsg("");
    try {
      await api.createUser(form);
      setForm({ email: "", password: "", display_name: "", role: "viewer" });
      setMsg("Đã tạo tài khoản");
      refresh();
    } catch (err) {
      setMsg(err.message);
    }
  }

  async function toggleActive(user) {
    await api.updateUser(user.id, { is_active: !user.is_active });
    refresh();
  }

  if (loading && !data) return <p className="empty">Đang tải…</p>;
  if (error) return <p className="empty">Lỗi: {error}</p>;

  return (
    <>
      <PageHeader title="Quản lý tài khoản" subtitle="Người dùng phân tích hệ thống" onRefresh={refresh} />

      <div className="admin-panel">
        <h3>Thêm tài khoản</h3>
        <form className="user-form" onSubmit={handleCreate}>
          <input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <input placeholder="Mật khẩu" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
          <input placeholder="Tên" value={form.display_name} onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          <select className="period-select" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          <button type="submit" className="btn btn-primary">Tạo</button>
        </form>
        {msg && <p className="muted" style={{ marginTop: "0.5rem" }}>{msg}</p>}
      </div>

      <div className="admin-panel">
        <table className="data-table">
          <thead>
            <tr><th>Email</th><th>Tên</th><th>Role</th><th>Trạng thái</th><th></th></tr>
          </thead>
          <tbody>
            {(data?.users || []).map((u) => (
              <tr key={u.id}>
                <td>{u.email}</td>
                <td>{u.display_name || "—"}</td>
                <td>{ROLE_LABELS[u.role]}</td>
                <td>{u.is_active ? "Active" : "Disabled"}</td>
                <td>
                  <button type="button" className="btn btn-ghost" onClick={() => toggleActive(u)}>
                    {u.is_active ? "Khóa" : "Mở"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
