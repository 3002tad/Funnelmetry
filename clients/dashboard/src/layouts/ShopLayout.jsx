import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { isAdminRole } from "../lib/routes.js";

const LINKS = [
  { to: "/shop", label: "Tổng quan", end: true },
  { to: "/shop/revenue", label: "Doanh thu" },
  { to: "/shop/products", label: "Sản phẩm" },
  { to: "/shop/funnel", label: "Phễu mua" },
  { to: "/shop/chat", label: "Trợ lý AI" },
];

export function ShopLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="shop-root">
      <div className="shop-shell">
        <header className="shop-header">
          <div className="shop-brand">
            <div className="shop-brand-icon">🛍</div>
            <div>
              <h1>Shop Analytics</h1>
              <small>Báo cáo cửa hàng</small>
            </div>
          </div>
          <nav className="shop-nav">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => (isActive ? "active" : "")}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="shop-header-actions">
            {isAdminRole(user?.role) && (
              <button type="button" className="btn btn-ghost" onClick={() => navigate("/admin")}>
                Admin
              </button>
            )}
            <span className="shop-user-pill">{user?.display_name || user?.email}</span>
            <button type="button" className="btn btn-ghost" onClick={() => { logout(); navigate("/login"); }}>
              Thoát
            </button>
          </div>
        </header>
        <main className="shop-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
