import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { IconOverview } from "../components/icons.jsx";
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
    <div className="mgr-root login-page mgr-login">
      <div style={{ maxWidth: 420, width: "100%" }}>
        <div style={{ textAlign: "center", marginBottom: "2rem", color: "rgba(255,255,255,0.7)" }}>
          <div style={{
            width: 52, height: 52, borderRadius: 14,
            background: "linear-gradient(135deg, #f54e00, #ff8c42)",
            display: "flex", alignItems: "center", justifyContent: "center",
            margin: "0 auto 1rem", color: "#fff",
            boxShadow: "0 8px 24px rgba(245,78,0,0.4)",
          }}>
            <IconOverview size={26} />
          </div>
          <h1 style={{ color: "#fff", fontSize: "1.5rem", fontWeight: 800, letterSpacing: "-0.03em" }}>
            Store Analytics
          </h1>
          <p style={{ fontSize: "0.875rem", marginTop: "0.35rem" }}>
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
            className="btn btn-primary"
            style={{ width: "100%", marginTop: "1.5rem", padding: "0.75rem", justifyContent: "center", fontSize: "0.9rem" }}
            disabled={submitting}
          >
            {submitting ? "Đang đăng nhập…" : "Vào dashboard"}
          </button>
        </form>
      </div>
    </div>
  );
}
