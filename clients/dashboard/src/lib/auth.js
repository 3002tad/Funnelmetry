const TOKEN_KEY = "dashboard_token";
const USER_KEY = "dashboard_user";

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setSession(token, user) {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearSession() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

// Legacy — use lib/routes.js for route guards
export { canAccessAdmin, canAccessShop, homeForRole, isAdminRole } from "./routes.js";

export const ROLE_LABELS = {
  super_admin: "Super Admin",
  analyst: "Analyst",
  viewer: "Viewer",
};
