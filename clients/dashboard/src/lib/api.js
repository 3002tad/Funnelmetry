import { clearSession, getToken } from "./auth.js";

const BASE = "";

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(method, path, body, options = {}) {
  const { timeoutMs } = options;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
  });

  if (res.status === 401) {
    clearSession();
    window.location.href = "/login";
    throw new Error("Phiên đăng nhập hết hạn");
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 403) {
      const hint =
        data.hint === "admin_only"
          ? "Tài khoản Analytic không truy cập được khu Admin."
          : data.hint === "analyst_only"
            ? "Tài khoản Admin không truy cập được khu phân tích. Đăng nhập bằng tài khoản Analytic."
            : "Tài khoản không có quyền truy cập mục này.";
      throw new Error(hint);
    }
    throw new Error(data.error || `${path} → ${res.status}`);
  }
  return data;
}

const get = (path) => request("GET", path);

function periodQs(period = {}) {
  if (period.date) return `date=${encodeURIComponent(period.date)}`;
  return `minutes=${period.minutes ?? 60}`;
}
const post = (path, body) => request("POST", path, body);
const patch = (path, body) => request("PATCH", path, body);
const del = (path) => request("DELETE", path);

export const api = {
  login: (email, password) => post("/api/auth/login", { email, password }),
  me: () => get("/api/auth/me"),
  changePassword: (current_password, new_password) =>
    patch("/api/auth/change-password", { current_password, new_password }),

  users: () => get("/api/users"),
  createUser: (body) => post("/api/users", body),
  updateUser: (id, body) => patch(`/api/users/${id}`, body),
  deleteUser: (id) => del(`/api/users/${id}`),

  overview: (period = { minutes: 30 }) => get(`/api/overview?${periodQs(period)}`),
  events: (limit = 50) => get(`/api/events/recent?limit=${limit}`),
  funnel: (period = { minutes: 60 }) => get(`/api/funnel?${periodQs(period)}`),
  productsTop: (period = { minutes: 60 }, limit = 20) =>
    get(`/api/products/top?${periodQs(period)}&limit=${limit}`),
  productsAnomalies: (period = { minutes: 60 }) =>
    get(`/api/products/anomalies?${periodQs(period)}`),
  searchTop: (period = { minutes: 60 }, limit = 20) =>
    get(`/api/search/top?${periodQs(period)}&limit=${limit}`),
  searchFilters: (period = { minutes: 60 }) => get(`/api/search/filters?${periodQs(period)}`),
  banners: (period = { minutes: 60 }) => get(`/api/banners?${periodQs(period)}`),
  revenueSummary: (period = { minutes: 60 }) => get(`/api/revenue/summary?${periodQs(period)}`),
  revenueByCategory: (period = { minutes: 60 }) =>
    get(`/api/revenue/by-category?${periodQs(period)}`),
  systemPipeline: () => get("/api/system/pipeline"),
  systemSetup: () => get("/api/system/setup"),
  chat: (message, period, session_id) => {
    const body = { message };
    if (period?.date) body.date = period.date;
    else if (period?.minutes != null) body.minutes = period.minutes;
    else if (typeof period === "number") body.minutes = period;
    if (session_id) body.session_id = session_id;
    return request("POST", "/api/chat", body, { timeoutMs: 75_000 });
  },
  chatInsights: (limit = 12) => get(`/api/chat/insights?limit=${limit}`),
  chatSessions: () => get("/api/chat/sessions"),
  chatSessionCreate: () => post("/api/chat/sessions", {}),
  chatSessionMessages: (sessionId) => get(`/api/chat/sessions/${encodeURIComponent(sessionId)}/messages`),
  chatSessionDelete: (sessionId) => del(`/api/chat/sessions/${encodeURIComponent(sessionId)}`),
};
