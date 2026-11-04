import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useOutletContext } from "react-router-dom"
import type { ShellContext } from "../../app/AppShell"
import { useAuth } from "../../auth/AuthContext"
import { establishAiSession } from "../../lib/ai-handoff"

const frameName = "funnelmetry-ai-workspace"
const commonSections = [
  { path: "/", label: "Trò chuyện" },
  { path: "/construct/skills", label: "Kỹ năng" },
  { path: "/dashboards", label: "Bảng điều khiển AI" },
  { path: "/construct/knowledge", label: "Kho tri thức" },
  { path: "/construct/scheduled-tasks", label: "Tác vụ theo lịch" },
]
const adminSections = [
  { path: "/construct/database", label: "Nguồn dữ liệu AI" },
  { path: "/construct/connectors", label: "Kết nối AI" },
  { path: "/construct/models-config", label: "Nhà cung cấp mô hình" },
]

export function AiWorkspacePage() {
  const { token, user } = useAuth()
  const { theme } = useOutletContext<ShellContext>()
  const aiUrl = import.meta.env.VITE_DB_GPT_URL
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [error, setError] = useState("")
  const [ready, setReady] = useState(false)
  const [active, setActive] = useState("/")
  const allowed = user?.role === "super_admin" || user?.role === "analyst"
  const sections = useMemo(() => user?.role === "super_admin" ? [...commonSections, ...adminSections] : commonSections, [user?.role])
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
      if (typeof event.data.path === "string" && sections.some(section => section.path === event.data.path)) {
        setActive(event.data.path)
      }
      frameRef.current?.contentWindow?.postMessage({ type: "funnelmetry:ai-theme", theme: resolvedTheme }, aiOrigin)
    }
    window.addEventListener("message", onMessage)
    return () => window.removeEventListener("message", onMessage)
  }, [aiOrigin, resolvedTheme, sections])
  useEffect(() => {
    if (ready && aiOrigin) frameRef.current?.contentWindow?.postMessage({ type: "funnelmetry:ai-theme", theme: resolvedTheme }, aiOrigin)
  }, [ready, aiOrigin, resolvedTheme])

  function navigate(path: string) {
    if (!ready || !aiOrigin) return
    setActive(path)
    frameRef.current?.contentWindow?.postMessage({ type: "funnelmetry:ai-navigate", path }, aiOrigin)
  }

  if (!allowed) return <p role="alert">Tài khoản chưa có quyền truy cập Trợ lý AI.</p>
  if (!aiUrl || !aiOrigin) return <p role="alert">Trợ lý AI chưa được cấu hình.</p>
  return <section aria-label="Trợ lý AI" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Các phần của Trợ lý AI" className="flex flex-wrap gap-1">
        {sections.map(section => <button key={section.path} type="button" disabled={!ready}
          onClick={() => navigate(section.path)} aria-current={active === section.path ? "page" : undefined}
          className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${active === section.path ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
          {section.label}
        </button>)}
      </nav>
      <button type="button" onClick={connect} className="text-sm text-primary underline">Tải lại AI</button>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <iframe ref={frameRef} name={frameName} title="Không gian Trợ lý AI" className="h-[calc(100vh-11rem)] min-h-[600px] w-full border-0 bg-background" />
  </section>
}
