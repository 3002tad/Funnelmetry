import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { ManagerPeriodProvider } from "../context/ManagerPeriodContext.jsx";
import { NAV_ICONS } from "../components/icons.jsx";
import { ROLE_LABELS } from "../lib/auth.js";

const NAV = [
  { section: "Tổng quan" },
  { to: "/shop", label: "Tổng quan", iconKey: "overview", end: true },
  { to: "/shop/revenue", label: "Doanh thu", iconKey: "revenue" },
  { section: "Hành vi người dùng" },
  { to: "/shop/products", label: "Sản phẩm", iconKey: "products" },
  { to: "/shop/funnel", label: "Phễu chuyển đổi", iconKey: "funnel" },
  { to: "/shop/events", label: "Sự kiện", iconKey: "events" },
  { to: "/shop/search", label: "Tìm kiếm", iconKey: "search" },
  { to: "/shop/banners", label: "Banner", iconKey: "banners" },
  { section: "AI Assistant" },
  { to: "/shop/chat", label: "Chatbot", iconKey: "chat" },
];

export function ManagerLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <ManagerPeriodProvider>
    <div className="mgr-root">
      <div className="mgr-shell">
        <aside className="mgr-sidebar">
          <div className="mgr-brand">
            <div className="mgr-brand-icon">
              <NAV_ICONS.overview size={18} />
            </div>
            <div className="mgr-brand-text">
              <h1>Store Analytics</h1>
              <span>Hành vi người dùng</span>
            </div>
          </div>

          <div className="mgr-user">
            <strong>{user?.display_name || user?.email}</strong>
            <em>{ROLE_LABELS[user?.role]}</em>
          </div>

          <nav className="mgr-nav">
            {NAV.map((item, i) => {
              if (item.section) {
                return <div key={i} className="nav-section">{item.section}</div>;
              }
              const Icon = NAV_ICONS[item.iconKey];
              return (
                <NavLink
                  key={item.to}
                  to={{ pathname: item.to, search: location.search }}
                  end={item.end}
                  className={({ isActive }) => (isActive ? "active" : "")}
                >
                  <span className="nav-icon">{Icon && <Icon size={18} />}</span>
                  {item.label}
                </NavLink>
              );
            })}
          </nav>

          <div className="mgr-footer">
            <button
              type="button"
              className="btn-sidebar"
              onClick={() => { logout(); navigate("/login"); }}
            >
              Đăng xuất
            </button>
          </div>
        </aside>

        <main className="mgr-main">
          <div className="mgr-page-wrap">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
    </ManagerPeriodProvider>
  );
}
