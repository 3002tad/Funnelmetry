import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { apiRequest, dashboardApiUrl, TOKEN_KEY, USER_KEY } from "../lib/api"
import { clearAiSession } from "../lib/ai-handoff"

type User = { id: string; email: string; display_name: string; role: string; permissions?: string[] }
type AuthValue = {
  token: string | null
  user: User | null
  login: (email: string, password: string) => Promise<void>
  logout: () => void
}

const AuthContext = createContext<AuthValue | null>(null)

function storedUser(): User | null {
  try {
    const raw = localStorage.getItem(USER_KEY)
    return raw ? JSON.parse(raw) as User : null
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState(() => {
    try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
  })
  const [user, setUser] = useState<User | null>(storedUser)

  const logout = () => {
    const aiUrl = import.meta.env.VITE_DB_GPT_URL
    if (aiUrl) void clearAiSession(aiUrl).catch(() => {})
    try {
      for (let i = sessionStorage.length - 1; i >= 0; i--) {
        const key = sessionStorage.key(i)
        if (key?.startsWith('funnelmetry:chat:')) sessionStorage.removeItem(key)
      }
    } catch { /* Storage can be blocked by browser policy. */ }
    try {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
    } catch { /* Storage can be blocked by browser policy. */ }
    setToken(null)
    setUser(null)
  }

  useEffect(() => {
    window.addEventListener("funnelmetry:unauthorized", logout)
    return () => window.removeEventListener("funnelmetry:unauthorized", logout)
  })

  useEffect(() => {
    if (!token) return
    apiRequest<{ user: User }>("/api/auth/me")
      .then((response) => {
        setUser(response.user)
        localStorage.setItem(USER_KEY, JSON.stringify(response.user))
      })
      // A transient API/network failure must not invalidate an otherwise valid session.
      // apiRequest already dispatches an unauthorized event for a confirmed 401.
      .catch(() => {})
  }, [token])

  useEffect(() => {
    const refresh = () => {
      if (!token) return
      void apiRequest<{user:User}>("/api/auth/me").then(({user:next})=>{setUser(next);localStorage.setItem(USER_KEY,JSON.stringify(next))}).catch(()=>{})
    }
    window.addEventListener('funnelmetry:profile-updated',refresh)
    return ()=>window.removeEventListener('funnelmetry:profile-updated',refresh)
  },[token])
  const value = useMemo<AuthValue>(() => ({
    token,
    user,
    async login(email, password) {
      const response = await fetch(`${dashboardApiUrl}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      })
      const body = await response.json().catch(() => ({})) as { token?: string; user?: User; error?: string }
      if (!response.ok || !body.token || !body.user) throw new Error(body.error || "login_failed")
      localStorage.setItem(TOKEN_KEY, body.token)
      localStorage.setItem(USER_KEY, JSON.stringify(body.user))
      setToken(body.token)
      setUser(body.user)
    },
    logout,
  }), [token, user])

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error("useAuth must be used inside AuthProvider")
  return value
}
