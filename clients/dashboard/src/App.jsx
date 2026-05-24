import { Navigate, Route, Routes } from "react-router-dom";
import { AdminGuard } from "./layouts/AdminGuard.jsx";
import { AdminLayout } from "./layouts/AdminLayout.jsx";
import { ShopGuard } from "./layouts/ShopGuard.jsx";
import { ShopLayout } from "./layouts/ShopLayout.jsx";
import { useAuth } from "./context/AuthContext.jsx";
import { homeForRole } from "./lib/routes.js";
import { BannersPage } from "./pages/BannersPage.jsx";
import { EventsPage } from "./pages/EventsPage.jsx";
import { FunnelPage } from "./pages/FunnelPage.jsx";
import { LoginPage } from "./pages/LoginPage.jsx";
import { OverviewPage } from "./pages/OverviewPage.jsx";
import { ProductsPage } from "./pages/ProductsPage.jsx";
import { RevenuePage } from "./pages/RevenuePage.jsx";
import { SearchPage } from "./pages/SearchPage.jsx";
import { SystemPage } from "./pages/SystemPage.jsx";
import { UsersPage } from "./pages/UsersPage.jsx";
import { ChatPage } from "./pages/ChatPage.jsx";

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

      <Route element={<ShopGuard />}>
        <Route element={<ShopLayout />}>
          <Route path="/shop" element={<OverviewPage variant="shop" />} />
          <Route path="/shop/revenue" element={<RevenuePage variant="shop" />} />
          <Route path="/shop/products" element={<ProductsPage variant="shop" />} />
          <Route path="/shop/funnel" element={<FunnelPage variant="shop" />} />
          <Route path="/shop/chat" element={<ChatPage variant="shop" />} />
        </Route>
      </Route>

      <Route element={<AdminGuard />}>
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<OverviewPage variant="admin" />} />
          <Route path="/admin/system" element={<SystemPage />} />
          <Route path="/admin/revenue" element={<RevenuePage variant="admin" />} />
          <Route path="/admin/products" element={<ProductsPage variant="admin" />} />
          <Route path="/admin/funnel" element={<FunnelPage variant="admin" />} />
          <Route path="/admin/search" element={<SearchPage />} />
          <Route path="/admin/banners" element={<BannersPage />} />
          <Route path="/admin/events" element={<EventsPage />} />
          <Route path="/admin/users" element={<UsersPage />} />
          <Route path="/admin/chat" element={<ChatPage variant="admin" />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
