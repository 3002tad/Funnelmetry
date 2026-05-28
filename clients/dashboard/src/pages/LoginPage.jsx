import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { IconOverview } from "../components/icons.jsx";
import { homeForRole, resolvePostLoginPath } from "../lib/routes.js";

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
      navigate(resolvePostLoginPath(u.role, dest), { replace: true });
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
    <div className="mgr-root login-page mgr-login">
      <div className="mgr-login-shell">
        <div className="mgr-login-head">
          <div className="mgr-login-logo">
            <IconOverview size={26} />
          </div>
          <h1 className="mgr-login-title">Store Analytics</h1>
          <p className="mgr-login-subtitle">
            Hành vi người dùng · Doanh thu · AI Chatbot
          </p>
        </div>

        <form className="login-card" onSubmit={handleSubmit}>
          <h2>Đăng nhập</h2>
          <p>Dashboard dành cho người quản lý website</p>

          {error && <div className="login-error">{error}</div>}

          <label>
            Email
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoComplete="username" />
          </label>
          <label>
            Mật khẩu
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
          </label>

          <button
            type="submit"
            className="btn btn-primary mgr-login-submit"
            disabled={submitting}
          >
            {submitting ? "Đang đăng nhập…" : "Vào dashboard"}
          </button>
        </form>
      </div>
    </div>
  );
}
