import bcrypt from "bcryptjs";

const ROUNDS = 10;

export async function hashPassword(plain) {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// Whitespace alone does not count as a special character.
export function isValidPassword(value) {
  return typeof value === 'string' && value.length >= 8
    && /[A-Z]/.test(value) && /[a-z]/.test(value)
    && /[0-9]/.test(value) && /[^\p{L}\p{N}\s]/u.test(value);
}
