import { verifyToken } from "../lib/jwt.js";

export function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "unauthorized" });
  }
  try {
    const payload = verifyToken(header.slice(7));
    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
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
