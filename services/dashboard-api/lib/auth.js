const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  if (process.env.NODE_ENV === "production") {
    console.error("[auth] FATAL: JWT_SECRET is required in production");
    process.exit(1);
  }
  console.warn("[auth] WARNING: JWT_SECRET not set — using insecure dev fallback");
}
const EFFECTIVE_JWT_SECRET = JWT_SECRET || "dev-only-insecure-fallback";
const JWT_EXPIRES_IN = "24h";

const DEFAULT_USERS = [
  { username: "admin",  password: process.env.ADMIN_PASSWORD  || "admin123",  displayName: "Admin",  role: "admin"  },
  { username: "viewer", password: process.env.VIEWER_PASSWORD || "viewer123", displayName: "Viewer", role: "viewer" },
];

const userStore = [];

async function seedUsers() {
  for (const u of DEFAULT_USERS) {
    const hash = await bcrypt.hash(u.password, 10);
    userStore.push({
      id: `user_${u.username}`,
      username: u.username,
      passwordHash: hash,
      displayName: u.displayName,
      role: u.role,
      createdAt: new Date().toISOString(),
    });
  }
  console.log(`[auth] Seeded ${userStore.length} default users`);
}

const usersReady = seedUsers();

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing or invalid authorization header" });
  }
  const token = authHeader.slice(7);
  try {
    req.user = jwt.verify(token, EFFECTIVE_JWT_SECRET);
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
    EFFECTIVE_JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN },
  );
}

module.exports = {
  userStore,
  usersReady,
  authMiddleware,
  signToken,
  bcrypt,
};
