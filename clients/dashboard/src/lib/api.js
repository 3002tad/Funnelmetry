import { clearSession, getToken } from "./auth.js";

const BASE = "";

function authHeaders() {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function request(method, path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
    },
    body: body ? JSON.stringify(body) : undefined,
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

  overview: (minutes = 30) => get(`/api/overview?minutes=${minutes}`),
  events: (limit = 50) => get(`/api/events/recent?limit=${limit}`),
  funnel: (minutes = 60) => get(`/api/funnel?minutes=${minutes}`),
  productsTop: (minutes = 60, limit = 20) =>
    get(`/api/products/top?minutes=${minutes}&limit=${limit}`),
  productsAnomalies: (minutes = 60) => get(`/api/products/anomalies?minutes=${minutes}`),
  searchTop: (minutes = 60, limit = 20) =>
    get(`/api/search/top?minutes=${minutes}&limit=${limit}`),
  searchFilters: (minutes = 60) => get(`/api/search/filters?minutes=${minutes}`),
  banners: (minutes = 60) => get(`/api/banners?minutes=${minutes}`),
  revenueSummary: (minutes = 60) => get(`/api/revenue/summary?minutes=${minutes}`),
  revenueByCategory: (minutes = 60) => get(`/api/revenue/by-category?minutes=${minutes}`),
  systemPipeline: () => get("/api/system/pipeline"),
  systemSetup: () => get("/api/system/setup"),
  chat: (message, minutes) =>
    post("/api/chat", minutes != null ? { message, minutes } : { message }),
  chatInsights: (limit = 12) => get(`/api/chat/insights?limit=${limit}`),
};
