import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useNavigate, useOutletContext } from "react-router-dom"
import type { ShellContext } from "../../app/AppShell"
import { useAuth } from "../../auth/AuthContext"
import { establishAiSession } from "../../lib/ai-handoff"

const frameName = "funnelmetry-ai-workspace"

export function AiWorkspacePage() {
  const { token, user } = useAuth()
  const { theme, setThemePreference } = useOutletContext<ShellContext>()
  const navigate = useNavigate()
  const aiUrl = import.meta.env.VITE_DB_GPT_URL
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [error, setError] = useState("")
  const [ready, setReady] = useState(false)
  const [systemDark, setSystemDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches)
  const allowed = user?.role === "super_admin" || user?.role === "analyst"
  const aiOrigin = useMemo(() => {
    try { return aiUrl ? new URL(aiUrl).origin : "" } catch { return "" }
  }, [aiUrl])
  const resolvedTheme = theme === "system" ? (systemDark ? "dark" : "light") : theme

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => setSystemDark(media.matches)
    media.addEventListener("change", onChange)
    return () => media.removeEventListener("change", onChange)
  }, [])

  const connect = useCallback(() => {
    if (!aiUrl || !token || !allowed) return
    try {
      setError("")
      setReady(false)
      establishAiSession(aiUrl, token, frameName)
    } catch {
      setError("Không thể mở Trợ lý AI. Hãy kiểm tra cấu hình và thử lại.")
    }
  }, [aiUrl, token, allowed])

  useEffect(() => { connect() }, [connect])
  useEffect(() => {
    if (!aiOrigin) return
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== aiOrigin || event.source !== frameRef.current?.contentWindow) return
      if (event.data?.type === "funnelmetry:ai-back") {
        navigate("/")
      } else if (event.data?.type === "funnelmetry:ai-theme-change" &&
          (event.data.theme === "light" || event.data.theme === "dark")) {
        void setThemePreference(event.data.theme)
      } else if (event.data?.type === "funnelmetry:ai-ready") {
        setReady(true)
        frameRef.current?.contentWindow?.postMessage({ type: "funnelmetry:ai-theme", theme: resolvedTheme }, aiOrigin)
      }
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [aiOrigin, resolvedTheme, navigate, setThemePreference])
  useEffect(() => {
    if (ready && aiOrigin) frameRef.current?.contentWindow?.postMessage({ type: "funnelmetry:ai-theme", theme: resolvedTheme }, aiOrigin)
  }, [ready, aiOrigin, resolvedTheme])

  if (!allowed) return <p role="alert">Tài khoản chưa có quyền truy cập Trợ lý AI.</p>
  if (!aiUrl || !aiOrigin) return <p role="alert">Trợ lý AI chưa được cấu hình.</p>
  return <section aria-label="Trợ lý AI">
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <iframe ref={frameRef} name={frameName} title="Không gian Trợ lý AI" className="h-screen min-h-[600px] w-full border-0 bg-background" />
  </section>
}
