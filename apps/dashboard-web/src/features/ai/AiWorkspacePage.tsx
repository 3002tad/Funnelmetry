import { useCallback, useEffect, useState } from "react"
import { useAuth } from "../../auth/AuthContext"
import { establishAiSession } from "../../lib/ai-handoff"

const frameName = "funnelmetry-ai-workspace"

export function AiWorkspacePage() {
  const { token, user } = useAuth()
  const aiUrl = import.meta.env.VITE_DB_GPT_URL
  const [error, setError] = useState("")
  const allowed = user?.role === "super_admin" || user?.role === "analyst"
  const connect = useCallback(() => {
    if (!aiUrl || !token || !allowed) return
    try {
      setError("")
      establishAiSession(aiUrl, token, frameName)
    } catch {
      setError("Không thể mở Trợ lý AI. Hãy kiểm tra cấu hình và thử lại.")
    }
  }, [aiUrl, token, allowed])

  useEffect(() => { connect() }, [connect])

  if (!allowed) return <p role="alert">Tài khoản chưa có quyền truy cập Trợ lý AI.</p>
  if (!aiUrl) return <p role="alert">Trợ lý AI chưa được cấu hình.</p>
  return <section aria-label="Trợ lý AI" className="space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground">
      <p>Nếu khung AI không hiển thị, hãy đăng nhập Cloudflare Access rồi tải lại.</p>
      <div className="flex items-center gap-3">
        <a href={aiUrl} target="_blank" rel="noopener noreferrer" className="text-primary underline">Đăng nhập Cloudflare Access</a>
        <button type="button" onClick={connect} className="text-primary underline">Tải lại AI</button>
      </div>
    </div>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <iframe name={frameName} title="Không gian Trợ lý AI" className="h-[calc(100vh-12rem)] min-h-[600px] w-full rounded-xl border bg-white" />
  </section>
}
