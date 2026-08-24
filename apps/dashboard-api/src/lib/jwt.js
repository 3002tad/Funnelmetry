import jwt from "jsonwebtoken";
import { config } from "../config.js";

export function signToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role },
    config.jwtSecret,
    { expiresIn: config.jwtExpires }
  );
}

export function verifyToken(token) {
  return jwt.verify(token, config.jwtSecret);
}
