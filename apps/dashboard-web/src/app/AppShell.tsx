import { useEffect, useState } from "react"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import { Activity, BarChart3, Box, ChevronDown, DatabaseZap, Filter, Lightbulb, LogOut, Menu, MessageSquare, Moon, Network, Search, Settings, Sun, X } from "lucide-react"
import { Button } from "../components/ui/button"
import { cn } from "../lib/utils"
import { useAuth } from "../auth/AuthContext"
import { analyticsSourceId } from "../lib/api"

const nav = [
  { to: "/overview", label: "Overview", icon: BarChart3 },
  { to: "/funnels", label: "Funnels", icon: Filter },
  { to: "/journeys", label: "Journeys", icon: Network },
  { to: "/products", label: "Products", icon: Box },
  { to: "/events", label: "Events", icon: Activity },
  { to: "/data-health", label: "Data Health", icon: DatabaseZap },
  { to: "/insights", label: "Insights", icon: Lightbulb },
]

export type ShellContext = { range: string; workspace: string; sourceId: string }

export function AppShell() {
  const [dark, setDark] = useState(false)
  const [menu, setMenu] = useState(false)
  const [range, setRange] = useState("Last 30 days")
  const workspace = import.meta.env.VITE_ANALYTICS_WORKSPACE_NAME || "Nord Commerce"
  const { user, logout } = useAuth()
  const visibleNav = user?.permissions?.includes('pipeline.monitor') ? [
    { to: '/admin/pipeline', label: 'Pipeline Health', icon: Activity },
    ...(user.permissions.includes('user.manage') ? [{ to: '/admin/users', label: 'Users / Roles', icon: Settings }] : []),
  ] : user?.permissions?.includes('analytics.read') ? [...nav,
    ...(user.permissions.includes('chat.use') ? [{ to: '/chat', label: 'AI Chat', icon: MessageSquare }] : []),
  ] : []
  const location = useLocation()

  useEffect(() => setMenu(false), [location.pathname])
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark)
  }, [dark])

  return (
    <div className="min-h-screen bg-background">
      {menu && <button aria-label="Close navigation" className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setMenu(false)} />}
      <aside className={cn("fixed inset-y-0 left-0 z-40 flex w-[248px] flex-col border-r bg-card transition-transform lg:translate-x-0", menu ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex h-16 items-center justify-between border-b px-4">
          <div className="flex items-center gap-2.5"><div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-white"><Filter size={17} /></div><div><strong className="block text-sm">Funnelmetry</strong><span className="block text-[10px] text-muted-foreground">Product intelligence</span></div></div>
          <Button className="lg:hidden" variant="ghost" size="icon" onClick={() => setMenu(false)}><X size={18} /></Button>
        </div>
        <div className="p-3">
          <button className="flex w-full items-center justify-between rounded-lg border bg-background px-3 py-2 text-left"><span><span className="block text-[10px] uppercase tracking-wider text-muted-foreground">Workspace</span><strong className="mt-0.5 block text-xs">{workspace}</strong></span><ChevronDown size={14} className="text-muted-foreground" /></button>
        </div>
        <nav className="scrollbar-thin flex-1 overflow-y-auto px-3 py-2">
          <p className="px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">{user?.permissions?.includes('pipeline.monitor') ? 'Administration' : 'Analyze'}</p>
          {visibleNav.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => cn("mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground", isActive && "bg-primary/10 font-medium text-primary")}><Icon size={17} />{label}</NavLink>)}
          <p className="px-3 pb-2 pt-5 text-[10px] font-semibold uppercase tracking-[.15em] text-muted-foreground">Manage</p>
          <NavLink to="/settings" className={({ isActive }) => cn("flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground", isActive && "bg-primary/10 font-medium text-primary")}><Settings size={17} />Settings</NavLink>
        </nav>
        <div className="border-t p-3"><div className="flex items-center gap-3 rounded-lg p-2"><div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-sky-400 to-blue-600 text-xs font-semibold text-white">{(user?.display_name || user?.email || "U").slice(0, 2).toUpperCase()}</div><div className="min-w-0 flex-1"><strong className="block truncate text-xs">{user?.display_name || user?.email || "Analyst"}</strong><span className="block truncate text-[10px] text-muted-foreground">{user?.role || "analytics"}</span></div><Button variant="ghost" size="icon" onClick={logout} aria-label="Đăng xuất"><LogOut size={14} /></Button></div></div>
      </aside>

      <div className="lg:pl-[248px]">
        <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur-xl md:px-6">
          <Button className="lg:hidden" variant="ghost" size="icon" onClick={() => setMenu(true)}><Menu size={19} /></Button>
          <div className="relative hidden max-w-sm flex-1 md:block"><Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" /><input className="h-9 w-full rounded-lg border bg-card pl-9 pr-3 text-xs placeholder:text-muted-foreground" placeholder="Search journeys, sessions, events…" /></div>
          <div className="ml-auto flex items-center gap-2">
            <div className="hidden h-9 items-center rounded-lg border bg-card px-3 text-xs sm:flex">{workspace}</div>
            {user?.permissions?.includes('analytics.read') && <select value={range} onChange={(event) => setRange(event.target.value)} className="h-9 rounded-lg border bg-card px-3 text-xs"><option>Last 7 days</option><option>Last 30 days</option><option>Last 90 days</option></select>}
            <Button variant="outline" size="icon" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? <Sun size={16} /> : <Moon size={16} />}</Button>
          </div>
        </header>
        <main className="mx-auto max-w-[1600px] p-4 md:p-6 lg:p-8"><Outlet context={{ range, workspace, sourceId: analyticsSourceId } satisfies ShellContext} /></main>
      </div>
    </div>
  )
}
