export const dashboardApiUrl = (import.meta.env.VITE_DASHBOARD_API_URL || "http://localhost:32000").replace(/\/$/, "")
export const analyticsSourceId = import.meta.env.VITE_ANALYTICS_SOURCE_ID || "medusa-reference"
export const TOKEN_KEY = "dashboard_token"
export const USER_KEY = "dashboard_user"

export class ApiError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = "ApiError"
    this.status = status
  }
}

export function getToken() {
  return localStorage.getItem(TOKEN_KEY)
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = getToken()
  const response = await fetch(`${dashboardApiUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  })
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event("funnelmetry:unauthorized"))
    const body = await response.json().catch(() => ({})) as { message?: string; error?: string }
    throw new ApiError(response.status, body.message || body.error || `Request failed (${response.status})`)
  }
  return response.json() as Promise<T>
}
