import { verifyToken } from "../lib/jwt.js";
import { canAccessAdmin, canAccessChat, canAccessShop } from "../lib/roles.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  let token = null;

  if (header?.startsWith("Bearer ")) {
    token = header.slice(7);
  } else if (req.path === "/api/events/stream" && typeof req.query?.token === "string") {
    // EventSource cannot send Authorization header, so SSE uses token query param.
    token = req.query.token;
  }

  if (!token) return res.status(401).json({ error: "unauthorized" });
  try {
    const payload = verifyToken(token);
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      session_version: payload.session_version,
    };
    next();
  } catch {
    return res.status(401).json({ error: "invalid_token" });
  }
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "forbidden" });
    }
    next();
  };
}

export function requireShopRole(req, res, next) {
  if (canAccessShop(req.user?.role)) return next();
  return res.status(403).json({
    error: "forbidden",
    hint: "analyst_only",
    role: req.user?.role || null,
  });
}

export function requireAdminRole(req, res, next) {
  if (canAccessAdmin(req.user?.role)) return next();
  return res.status(403).json({
    error: "forbidden",
    hint: "admin_only",
    role: req.user?.role || null,
  });
}

export function requireChatRole(req, res, next) {
  if (canAccessChat(req.user?.role)) return next();
  return res.status(403).json({
    error: "forbidden",
    hint: "chat_requires_admin_or_analyst",
    role: req.user?.role || null,
  });
}
