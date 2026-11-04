import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useOutletContext } from "react-router-dom"
import type { ShellContext } from "../../app/AppShell"
import { useAuth } from "../../auth/AuthContext"
import { establishAiSession } from "../../lib/ai-handoff"

const frameName = "funnelmetry-ai-workspace"

export function AiWorkspacePage() {
  const { token, user } = useAuth()
  const { theme } = useOutletContext<ShellContext>()
  const aiUrl = import.meta.env.VITE_DB_GPT_URL
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [error, setError] = useState("")
  const [ready, setReady] = useState(false)
  const allowed = user?.role === "super_admin" || user?.role === "analyst"
  const aiOrigin = useMemo(() => {
    try { return aiUrl ? new URL(aiUrl).origin : "" } catch { return "" }
  }, [aiUrl])
  const resolvedTheme = theme === "system"
    ? (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : theme

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
      if (event.data?.type !== "funnelmetry:ai-ready") return
      setReady(true)
      frameRef.current?.contentWindow?.postMessage({ type: "funnelmetry:ai-theme", theme: resolvedTheme }, aiOrigin)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [aiOrigin, resolvedTheme])
  useEffect(() => {
    if (ready && aiOrigin) frameRef.current?.contentWindow?.postMessage({ type: "funnelmetry:ai-theme", theme: resolvedTheme }, aiOrigin)
  }, [ready, aiOrigin, resolvedTheme])

  if (!allowed) return <p role="alert">Tài khoản chưa có quyền truy cập Trợ lý AI.</p>
  if (!aiUrl || !aiOrigin) return <p role="alert">Trợ lý AI chưa được cấu hình.</p>
  return <section aria-label="Trợ lý AI">
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <iframe ref={frameRef} name={frameName} title="Không gian Trợ lý AI" className="h-[calc(100vh-76px)] min-h-[600px] w-full border-0 bg-background" />
  </section>
}
