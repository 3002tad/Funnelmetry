const express = require("express");
const { userStore, usersReady, authMiddleware, signToken, bcrypt } = require("../lib/auth");

const router = express.Router();

// POST /api/auth/login
router.post("/login", async (req, res) => {
  await usersReady;
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  const user = userStore.find((u) => u.username === username);
  if (!user) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ error: "Invalid username or password" });
  }

  const token = signToken(user);
  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    },
  });
});

// GET /api/auth/me
router.get("/me", authMiddleware, (req, res) => {
  res.json({
    id: req.user.id,
    username: req.user.username,
    displayName: req.user.displayName,
    role: req.user.role,
  });
});

// POST /api/auth/register (admin only)
router.post("/register", authMiddleware, async (req, res) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ error: "Only admins can register new users" });
  }

  const { username, password, displayName, role } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: "Username and password are required" });
  }

  const validRoles = ["admin", "viewer"];
  if (role && !validRoles.includes(role)) {
    return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(", ")}` });
  }

  if (userStore.find((u) => u.username === username)) {
    return res.status(409).json({ error: "Username already exists" });
  }

  const hash = await bcrypt.hash(password, 10);
  const newUser = {
    id: `user_${username}`,
    username,
    passwordHash: hash,
    displayName: displayName || username,
    role: role || "viewer",
    createdAt: new Date().toISOString(),
  };
  userStore.push(newUser);

  res.status(201).json({
    id: newUser.id,
    username: newUser.username,
    displayName: newUser.displayName,
    role: newUser.role,
  });
});

module.exports = router;
