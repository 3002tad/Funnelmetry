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
      setMsg("✓ Đã tạo tài khoản");
      refresh();
    } catch (err) {
      setMsg(`✗ ${err.message}`);
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
      <PageHeader variant="admin" title="Tài khoản" subtitle="Quản lý người dùng dashboard" onRefresh={refresh} />

      <div className="admin-panel">
        <h3>Thêm tài khoản mới</h3>
        <form className="user-form" onSubmit={handleCreate}>
          <input placeholder="Email" type="email" value={form.email}
            onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          <input placeholder="Mật khẩu" type="password" value={form.password}
            onChange={(e) => setForm({ ...form, password: e.target.value })} required minLength={6} />
          <input placeholder="Tên hiển thị" value={form.display_name}
            onChange={(e) => setForm({ ...form, display_name: e.target.value })} />
          <select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
          </select>
          <button type="submit" className="btn btn-primary">Tạo</button>
        </form>
        {msg && (
          <p style={{ marginTop: "0.5rem", fontSize: "0.82rem", padding: "0.5rem 1rem", color: msg.startsWith("✓") ? "var(--success)" : "var(--danger)" }}>
            {msg}
          </p>
        )}
      </div>

      <div className="admin-panel">
        <h3>Danh sách</h3>
        <table className="data-table">
          <thead>
            <tr><th>Email</th><th>Tên</th><th>Role</th><th>Trạng thái</th><th></th></tr>
          </thead>
          <tbody>
            {(data?.users || []).map((u) => (
              <tr key={u.id}>
                <td style={{ fontFamily: "var(--mono)" }}>{u.email}</td>
                <td>{u.display_name || "—"}</td>
                <td><span className="badge" style={{ background: "var(--accent-soft)", color: "#93c5fd" }}>{ROLE_LABELS[u.role]}</span></td>
                <td>
                  <span className={`badge ${u.is_active ? "ok" : "down"}`}>
                    {u.is_active ? "Active" : "Disabled"}
                  </span>
                </td>
                <td>
                  <button type="button" className={`btn ${u.is_active ? "btn-danger" : "btn-ghost"}`}
                    style={{ fontSize: "0.75rem", padding: "0.25rem 0.65rem" }}
                    onClick={() => toggleActive(u)}>
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
