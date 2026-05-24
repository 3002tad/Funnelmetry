import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { homeForRole } from "../lib/routes.js";

export function LoginPage() {
  const { login, isAuthenticated, loading, user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!loading && isAuthenticated && user) {
    const dest = location.state?.from?.pathname || homeForRole(user.role);
    return <Navigate to={dest} replace />;
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const u = await login(email, password);
      const dest = location.state?.from?.pathname;
      if (dest && (dest.startsWith("/admin") || dest.startsWith("/shop"))) {
        navigate(dest, { replace: true });
      } else {
        navigate(homeForRole(u.role), { replace: true });
      }
    } catch (err) {
      const msg = err.message || "";
      setError(
        msg.includes("invalid_credentials") || msg.includes("401")
          ? "Email hoặc mật khẩu không đúng"
          : msg
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="admin-root login-page admin-login">
      <div className="login-hero">
        <h1>Realtime Commerce Analytics</h1>
        <p>
          Theo dõi hành vi khách hàng, doanh thu và phễu chuyển đổi từ pipeline tracking của bạn.
        </p>
      </div>
      <div className="login-form-wrap">
        <form className="login-card" onSubmit={handleSubmit}>
          <h2>Đăng nhập</h2>
          <p className="muted">Tài khoản phân tích hệ thống</p>
          {error && <p className="login-error">{error}</p>}
          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
          </label>
          <label>
            Mật khẩu
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </label>
          <button type="submit" className="btn btn-primary" style={{ width: "100%", marginTop: "1.25rem" }} disabled={submitting}>
            {submitting ? "Đang đăng nhập…" : "Đăng nhập"}
          </button>
        </form>
      </div>
    </div>
  );
}
