import { useState, type FormEvent } from "react"
import { Navigate, useLocation } from "react-router-dom"
import { ArrowRight, Filter, LoaderCircle, ShieldCheck } from "lucide-react"
import { useAuth } from "../../auth/AuthContext"
import { Button } from "../../components/ui/button"
import { ThemeSelect } from "../../components/ui/theme-select"
import { useThemePreference } from "../../app/useThemePreference"

function LoginArtwork() {
  return <svg className="mt-10 h-auto w-full max-w-lg drop-shadow-2xl" viewBox="0 0 520 245" fill="none" aria-hidden="true">
    <defs><linearGradient id="login-glass" x1="0" y1="0" x2="520" y2="245" gradientUnits="userSpaceOnUse"><stop stopColor="#1e4d7e"/><stop offset="1" stopColor="#17356a"/></linearGradient><linearGradient id="login-path" x1="60" y1="180" x2="460" y2="66" gradientUnits="userSpaceOnUse"><stop stopColor="#38bdf8"/><stop offset=".55" stopColor="#67e8f9"/><stop offset="1" stopColor="#a5b4fc"/></linearGradient></defs>
    <rect x="6" y="8" width="508" height="226" rx="24" fill="url(#login-glass)" stroke="#7dd3fc" strokeOpacity=".3"/>
    <rect x="27" y="28" width="466" height="185" rx="16" fill="#0c2949" fillOpacity=".55" stroke="#c4e9ff" strokeOpacity=".13"/>
    <circle cx="51" cy="47" r="4" fill="#7dd3fc"/><circle cx="65" cy="47" r="4" fill="#a5b4fc"/><circle cx="79" cy="47" r="4" fill="#5eead4"/>
    <path d="M60 175C120 175 120 105 193 123S276 199 350 117 422 124 462 68" stroke="url(#login-path)" strokeWidth="6" strokeLinecap="round"/>
    <circle cx="64" cy="174" r="14" fill="#103455" stroke="#38bdf8" strokeWidth="4"/><circle cx="193" cy="123" r="14" fill="#103455" stroke="#67e8f9" strokeWidth="4"/><circle cx="350" cy="117" r="14" fill="#103455" stroke="#a5b4fc" strokeWidth="4"/><circle cx="460" cy="70" r="17" fill="#dbeafe"/>
    <path d="m453 70 5 5 10-11" stroke="#3764d4" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"/>
    <rect x="73" y="81" width="80" height="10" rx="5" fill="#7dd3fc" fillOpacity=".18"/><rect x="73" y="99" width="55" height="7" rx="3" fill="#7dd3fc" fillOpacity=".14"/>
    <rect x="261" y="160" width="88" height="10" rx="5" fill="#a5b4fc" fillOpacity=".18"/><rect x="261" y="178" width="61" height="7" rx="3" fill="#a5b4fc" fillOpacity=".14"/>
  </svg>
}

export function LoginPage() {
  const { token, login } = useAuth()
  const location = useLocation()
  const [theme, setTheme] = useThemePreference()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  if (token) return <Navigate to={(location.state as { from?: string } | null)?.from || "/"} replace />

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

  return <main className="min-h-screen bg-background lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(440px,.92fr)]">
    <section className="login-story relative hidden min-h-screen flex-col overflow-hidden px-[clamp(32px,6vw,100px)] py-11 text-white lg:flex" aria-label="Giới thiệu Funnelmetry">
      <div className="relative z-10 flex items-center gap-3"><div className="brand-mark"><Filter size={20} /></div><strong className="text-lg tracking-tight">Funnelmetry</strong></div>
      <div className="relative z-10 my-auto max-w-xl">
        <p className="mb-5 text-xs font-bold uppercase tracking-[.25em] text-sky-200">Product intelligence workspace</p>
        <h1 className="text-[clamp(2.6rem,4vw,4.5rem)] font-bold leading-[1.08] tracking-[-.045em]">Từ sự kiện đến<br /><span className="text-sky-300">góc nhìn rõ ràng.</span></h1>
        <p className="mt-6 max-w-md text-[15px] leading-7 text-slate-300">Theo dõi dữ liệu, chất lượng xử lý và bằng chứng phân tích trong cùng một không gian làm việc.</p>
        <LoginArtwork />
      </div>
      <p className="relative z-10 text-xs text-slate-400">Funnelmetry · Analytical workspace</p>
    </section>

    <section className="flex min-h-screen flex-col px-5 py-6 sm:px-10 lg:px-[clamp(42px,7vw,120px)]">
      <div className="flex items-center justify-between"><div className="flex items-center gap-2 lg:hidden"><div className="brand-mark"><Filter size={18} /></div><strong>Funnelmetry</strong></div><div className="ml-auto"><ThemeSelect value={theme} onChange={setTheme} /></div></div>
      <div className="my-auto w-full max-w-[420px] self-center py-12">
        <div className="mb-7 grid h-12 w-12 place-items-center rounded-2xl border border-primary/20 bg-primary/10 text-primary"><ShieldCheck size={23} aria-hidden="true" /></div>
        <p className="eyebrow mb-3">Chào mừng trở lại</p>
        <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Đăng nhập</h2>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">Sử dụng tài khoản Dashboard API để vào workspace của bạn.</p>
        <form onSubmit={submit} className="mt-9 space-y-5">
          <label className="block text-sm font-semibold">Email<input type="email" required value={email} onChange={event => setEmail(event.target.value)} className="mt-2 h-12 w-full rounded-xl border bg-card px-4 text-sm shadow-sm placeholder:text-muted-foreground/70" placeholder="name@example.com" autoComplete="email" /></label>
          <label className="block text-sm font-semibold">Mật khẩu<input type="password" required value={password} onChange={event => setPassword(event.target.value)} className="mt-2 h-12 w-full rounded-xl border bg-card px-4 text-sm shadow-sm" autoComplete="current-password" /></label>
          {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
          <Button className="h-12 w-full text-sm" disabled={submitting}>{submitting ? <LoaderCircle size={17} className="animate-spin" /> : <ArrowRight size={17} />}{submitting ? "Đang đăng nhập…" : "Vào workspace"}</Button>
        </form>
        <p className="mt-8 text-xs leading-5 text-muted-foreground">Quyền truy cập và các chức năng hiển thị phụ thuộc vai trò tài khoản của bạn.</p>
      </div>
      <p className="text-center text-xs text-muted-foreground">Funnelmetry · Product intelligence</p>
    </section>
  </main>
}
