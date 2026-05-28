import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { ROLE_LABELS } from "../lib/auth.js";

const NAV = [
  { section: "Hệ thống" },
  { to: "/admin/system", label: "Pipeline", icon: "⬡", end: true },
  { to: "/admin/k8s-dashboard", label: "K8s Dashboard", icon: "☸" },
  { to: "/admin/insights", label: "Chatbot & RAG", icon: "🤖" },
  { to: "/admin/setup", label: "Demo & Ports", icon: "⚙" },
  { section: "Quản lý" },
  { to: "/admin/users", label: "Tài khoản", icon: "👥" },
];

export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="admin-root">
      <div className="admin-shell">
        <aside className="admin-sidebar">
          <div className="admin-brand">
            <div className="admin-brand-icon">⬡</div>
            <div className="admin-brand-text">
              <span>Admin</span>
              <h1>Pipeline Monitor</h1>
            </div>
          </div>

          <div className="admin-user">
            <strong>{user?.display_name || user?.email}</strong>
            <em>{ROLE_LABELS[user?.role]}</em>
          </div>

          <nav className="admin-nav">
            {NAV.map((item, i) => {
              if (item.section) return <div key={i} className="nav-section">{item.section}</div>;
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) => (isActive ? "active" : "")}
                >
                  <span className="nav-icon">{item.icon}</span>
                  {item.label}
                </NavLink>
              );
            })}
          </nav>

          <div className="admin-footer">
            <button
              type="button"
              className="btn btn-ghost"
              style={{ width: "100%", justifyContent: "center" }}
              onClick={() => { logout(); navigate("/login"); }}
            >
              Đăng xuất
            </button>
          </div>
        </aside>

        <main className="admin-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
