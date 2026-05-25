import { Navigate, Route, Routes } from "react-router-dom";
import { AdminGuard } from "./layouts/AdminGuard.jsx";
import { AdminLayout } from "./layouts/AdminLayout.jsx";
import { ShopGuard } from "./layouts/ShopGuard.jsx";
import { ManagerLayout } from "./layouts/ManagerLayout.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import { homeForRole } from "./lib/routes.js";
import { BannersPage } from "./pages/BannersPage.jsx";
import { ChatPage } from "./pages/ChatPage.jsx";
import { EventsPage } from "./pages/EventsPage.jsx";
import { FunnelPage } from "./pages/FunnelPage.jsx";
import { LoginPage } from "./pages/LoginPage.jsx";
import { OverviewPage } from "./pages/OverviewPage.jsx";
import { ProductsPage } from "./pages/ProductsPage.jsx";
import { RevenuePage } from "./pages/RevenuePage.jsx";
import { SearchPage } from "./pages/SearchPage.jsx";
import { SystemPage } from "./pages/SystemPage.jsx";
import { UsersPage } from "./pages/UsersPage.jsx";

function RootRedirect() {
  const { user, loading, isAuthenticated } = useAuth();
  if (loading) return <p className="empty">Đang tải…</p>;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Navigate to={homeForRole(user.role)} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/" element={<RootRedirect />} />

      {/* Manager dashboard — all roles */}
      <Route element={<ShopGuard />}>
        <Route element={<ManagerLayout />}>
          <Route path="/shop" element={<OverviewPage />} />
          <Route path="/shop/revenue" element={<RevenuePage />} />
          <Route path="/shop/products" element={<ProductsPage />} />
          <Route path="/shop/funnel" element={<FunnelPage />} />
          <Route path="/shop/events" element={<EventsPage />} />
          <Route path="/shop/search" element={<SearchPage />} />
          <Route path="/shop/banners" element={<BannersPage />} />
          <Route path="/shop/chat" element={<ChatPage />} />
        </Route>
      </Route>

      {/* Admin dashboard — system only */}
      <Route element={<AdminGuard />}>
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<Navigate to="/admin/system" replace />} />
          <Route path="/admin/system" element={<SystemPage />} />
          <Route path="/admin/users" element={<UsersPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
