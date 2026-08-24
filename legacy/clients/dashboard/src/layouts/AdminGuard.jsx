import { Navigate, Outlet, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { canAccessAdmin, homeForRole } from "../lib/routes.js";

export function AdminGuard() {
  const { user, loading, isAuthenticated } = useAuth();
  const location = useLocation();

  if (loading) return <p className="empty">Đang tải…</p>;
  if (!isAuthenticated) return <Navigate to="/login" replace state={{ from: location }} />;
  if (!canAccessAdmin(user.role, location.pathname)) {
    return <Navigate to={homeForRole(user.role)} replace />;
  }
  return <Outlet />;
}
