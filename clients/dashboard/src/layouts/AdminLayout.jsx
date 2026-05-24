import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { ROLE_LABELS } from "../lib/auth.js";

const NAV = [
  { section: "Tổng quan" },
  { to: "/admin", label: "Overview", end: true },
  { to: "/admin/revenue", label: "Revenue" },
  { to: "/admin/products", label: "Products" },
  { to: "/admin/funnel", label: "Funnel" },
  { section: "Phân tích" },
  { to: "/admin/search", label: "Search" },
  { to: "/admin/banners", label: "Banners" },
  { to: "/admin/events", label: "Events" },
  { to: "/admin/chat", label: "Chatbot" },
  { section: "Hệ thống" },
  { to: "/admin/system", label: "Pipeline" },
  { to: "/admin/users", label: "Users", superOnly: true },
];

export function AdminLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="admin-root">
      <div className="admin-shell">
        <aside className="admin-sidebar">
          <div className="admin-brand">
            <span>Admin</span>
            <h1>Pipeline Analytics</h1>
          </div>
          <div className="admin-user">
            <strong>{user?.display_name || user?.email}</strong>
            <em>{ROLE_LABELS[user?.role]}</em>
          </div>
          <nav className="admin-nav">
            {NAV.map((item, i) => {
              if (item.section) return <div key={i} className="nav-section">{item.section}</div>;
              if (item.superOnly && user?.role !== "super_admin") return null;
              return (
                <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => (isActive ? "active" : "")}>
                  {item.label}
                </NavLink>
              );
            })}
          </nav>
          <div className="admin-footer">
            <button type="button" className="btn btn-link" onClick={() => navigate("/shop")}>
              → Shop Dashboard
            </button>
            <button type="button" className="btn btn-ghost" style={{ width: "100%" }} onClick={() => { logout(); navigate("/login"); }}>
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
