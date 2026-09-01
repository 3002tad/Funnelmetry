import { useState, type FormEvent } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { Filter, LoaderCircle } from "lucide-react"
import { useAuth } from "../../auth/AuthContext"
import { Button } from "../../components/ui/button"

export function LoginPage() {
  const { token, login } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  if (token) return <Navigate to={(location.state as { from?: string } | null)?.from || "/overview"} replace />

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSubmitting(true)
    setError("")
    try {
      await login(email, password)
    } catch {
      setError("Email hoặc mật khẩu không đúng, hoặc Dashboard API chưa sẵn sàng.")
    } finally {
      setSubmitting(false)
    }
  }

  return <main className="grid min-h-screen place-items-center bg-background p-4">
    <form onSubmit={submit} className="panel w-full max-w-sm p-7">
      <div className="mb-7 flex items-center gap-3"><div className="grid h-10 w-10 place-items-center rounded-xl bg-primary text-white"><Filter size={20} /></div><div><strong className="block">Funnelmetry</strong><span className="text-xs text-muted-foreground">Product intelligence</span></div></div>
      <h1 className="text-xl font-semibold">Đăng nhập</h1>
      <p className="mt-1 text-sm text-muted-foreground">Sử dụng tài khoản Dashboard API của hệ thống.</p>
      <label className="mt-6 block text-xs font-medium">Email<input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} className="mt-2 h-10 w-full rounded-lg border bg-background px-3 text-sm" autoComplete="email" /></label>
      <label className="mt-4 block text-xs font-medium">Mật khẩu<input type="password" required value={password} onChange={(event) => setPassword(event.target.value)} className="mt-2 h-10 w-full rounded-lg border bg-background px-3 text-sm" autoComplete="current-password" /></label>
      {error && <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-xs text-destructive">{error}</p>}
      <Button className="mt-6 w-full" disabled={submitting}>{submitting && <LoaderCircle size={15} className="animate-spin" />}{submitting ? "Đang đăng nhập…" : "Đăng nhập"}</Button>
    </form>
  </main>
}
