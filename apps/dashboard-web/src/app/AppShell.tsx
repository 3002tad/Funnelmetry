import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { NavLink, Outlet, useLocation } from "react-router-dom"
import {
  Activity, BarChart3, Blocks, BookOpen, Bot, Boxes, ChartNoAxesCombined,
  ChevronRight, ClipboardList, Database, FileChartColumn, FileClock,
  Filter, Fingerprint, GitBranch, HeartPulse, KeyRound, Layers3, LifeBuoy,
  ListFilter, LogOut, Menu, Package, Radar, Route, SearchCheck, Settings2,
  ShieldCheck, ShoppingBag, SlidersHorizontal, Sparkles, Tags, Users, X,
  type LucideIcon,
} from "lucide-react"
import { Button } from "../components/ui/button"
import { ThemeSelect } from "../components/ui/theme-select"
import { cn } from "../lib/utils"
import { useAuth } from "../auth/AuthContext"
import { analyticsSourceId, apiRequest } from "../lib/api"
import { accountPreferencesKey, type PreferencesResponse } from "../lib/account-preferences"
import type { ThemePreference } from "./useThemePreference"
import { visibleNavigation } from "./navigation"
import { useThemePreference } from "./useThemePreference"

export type ShellContext = { range: string; workspace: string; sourceId: string }

const icons: Record<string, LucideIcon> = {
  "/overview": ChartNoAxesCombined, "/workspace": Blocks, "/analysis-runs": FileClock,
  "/evidence": SearchCheck, "/funnels": Filter, "/journeys": Route,
  "/products": ShoppingBag, "/traffic": Radar, "/campaigns": Tags,
  "/metrics": BarChart3, "/assets": Database, "/findings": Sparkles,
  "/reports": FileChartColumn, "/events": Activity, "/data-health": HeartPulse,
  "/chat": Bot, "/admin/pipeline": HeartPulse, "/admin/recovery": LifeBuoy,
  "/admin/resources": Boxes, "/admin/audit": ClipboardList, "/admin/sources": GitBranch,
  "/admin/event-feed": ListFilter, "/admin/event-trace": Fingerprint,
  "/admin/connector": GitBranch, "/admin/processing": Blocks,
  "/admin/quarantine": ShieldCheck, "/admin/schemas": Layers3,
  "/admin/metadata": BookOpen, "/admin/metric-catalog": BarChart3,
  "/admin/recipes": BookOpen, "/admin/tools": Blocks,
  "/admin/agent": Bot, "/admin/run-diagnostics": SearchCheck,
  "/admin/model-provider": Sparkles, "/admin/users": Users,
  "/admin/integration-settings": KeyRound, "/admin/system-settings": SlidersHorizontal,
}

// The simple menu changes presentation only; routes and backend permissions stay intact.
const primaryPaths = new Set([
  "/overview", "/funnels", "/products", "/events", "/data-health", "/chat", "/settings",
  "/admin/pipeline", "/admin/processing",
])

export function AppShell() {
  const [menu, setMenu] = useState(false)
  const [showAllNavigation, setShowAllNavigation] = useState(false)
  const [range, setRange] = useState("Last 30 days")
  const [theme, setTheme] = useThemePreference()
  const [themeSaving, setThemeSaving] = useState(false)
  const [themeError, setThemeError] = useState("")
  const workspace = import.meta.env.VITE_ANALYTICS_WORKSPACE_NAME || "Funnelmetry Workspace"
  const { user, logout } = useAuth()
  const roleLabel = user?.role === "super_admin" ? "Quản trị hệ thống" : user?.role === "analyst" ? "Nhà phân tích" : user?.role || "Tài khoản"
  const queryClient = useQueryClient()
  const preferences = useQuery({
    queryKey: accountPreferencesKey(user?.id),
    queryFn: ({ signal }) => apiRequest<PreferencesResponse>("/api/account/preferences", { signal }),
    enabled: Boolean(user?.id), retry: false, staleTime: 30_000,
  })
  const groups = visibleNavigation(user?.permissions || [])
  const location = useLocation()
  const navigationExpanded = showAllNavigation || !primaryPaths.has(location.pathname)
  const shownGroups = navigationExpanded ? groups : groups.map(group => ({
    ...group, items: group.items.filter(item => primaryPaths.has(item.path)),
  })).filter(group => group.items.length > 0)
  const sidebarRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const appliedDefaultRange = useRef<{ userId: string; days: number } | null>(null)
  const current = groups.flatMap(group => group.items).find(item => item.path === location.pathname)
  const currentGroup = groups.find(group => group.items.some(item => item.path === location.pathname))

  useEffect(() => {
    if (!preferences.data || !user?.id) return
    setTheme(preferences.data.preferences.theme)
    const days = preferences.data.preferences.analytics_default_days
    if (appliedDefaultRange.current?.userId !== user.id || appliedDefaultRange.current.days !== days) {
      setRange(`Last ${days} days`)
      appliedDefaultRange.current = { userId: user.id, days }
    }
  }, [preferences.data, setTheme, user?.id])

  async function changeTheme(next: ThemePreference) {
    const previous = theme
    setTheme(next)
    setThemeError("")
    setThemeSaving(true)
    try {
      const saved = await apiRequest<PreferencesResponse>("/api/account/preferences", {
        method: "PATCH", body: JSON.stringify({ theme: next }),
      })
      queryClient.setQueryData(accountPreferencesKey(user?.id), saved)
    } catch {
      setTheme(previous)
      setThemeError("Không lưu được giao diện vào tài khoản. Thử lại sau.")
    } finally { setThemeSaving(false) }
  }

  function closeMenu() {
    setMenu(false)
    // The backdrop is removed on close; do not leave keyboard focus on it.
    requestAnimationFrame(() => menuButtonRef.current?.focus())
  }

  useEffect(() => { setMenu(false); mainRef.current?.focus({ preventScroll: true }) }, [location.pathname])
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)")
    const update = () => {
      if (sidebarRef.current) sidebarRef.current.inert = !desktop.matches && !menu
      if (contentRef.current) contentRef.current.inert = !desktop.matches && menu
      if (desktop.matches && menu) setMenu(false)
    }
    update()
    if (menu && !desktop.matches) closeButtonRef.current?.focus()
    desktop.addEventListener("change", update)
    return () => desktop.removeEventListener("change", update)
  }, [menu])
  useEffect(() => {
    if (!menu) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeMenu(); return }
      if (event.key !== "Tab" || !sidebarRef.current || window.matchMedia("(min-width: 1024px)").matches) return
      const focusables = Array.from(sidebarRef.current.querySelectorAll<HTMLElement>('a[href], button:not(:disabled)'))
      if (!focusables.length) return
      const first = focusables[0]
      const last = focusables[focusables.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", handleKeyDown)
      if (sidebarRef.current?.contains(document.activeElement)) menuButtonRef.current?.focus()
    }
  }, [menu])

  return <div className="app-shell min-h-screen">
    <a className="skip-link" href="#main-content">Chuyển tới nội dung chính</a>
    {menu && <button type="button" aria-label="Đóng menu điều hướng" className="app-overlay" onClick={closeMenu} />}
    <aside ref={sidebarRef} id="app-navigation" role={menu ? "dialog" : undefined} aria-modal={menu ? true : undefined} aria-label="Điều hướng chính" className={cn("app-sidebar", menu && "app-sidebar-open")}>
      <div className="app-brand">
        <div className="brand-mark"><Filter size={20} strokeWidth={2.3} aria-hidden="true" /></div>
        <div className="min-w-0"><strong className="block text-[15px] tracking-tight">Funnelmetry</strong><span className="block text-[10px] tracking-[.1em] text-slate-400">INTELLIGENCE WORKSPACE</span></div>
        <button ref={closeButtonRef} type="button" className="ml-auto grid h-9 w-9 place-items-center rounded-xl text-slate-300 hover:bg-white/10 hover:text-white lg:hidden" onClick={closeMenu} aria-label="Đóng menu"><X size={19} /></button>
      </div>
      <div className="px-4 pb-3 pt-5"><div className="workspace-card"><div className="workspace-monogram">{workspace.charAt(0).toUpperCase()}</div><div className="min-w-0"><span className="block text-[10px] font-medium uppercase tracking-[.14em] text-slate-400">Workspace</span><strong className="block truncate text-xs text-white">{workspace}</strong></div></div></div>
      <nav aria-label="Workspace navigation" className="scrollbar-thin app-nav flex-1 overflow-y-auto px-3 pb-5">
        {primaryPaths.has(location.pathname) ? <button type="button" className="mb-5 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-left text-xs font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300" onClick={() => setShowAllNavigation(value => !value)} aria-expanded={navigationExpanded}>
          {navigationExpanded ? "Thu gọn menu" : "Xem tất cả chức năng"}
        </button> : <NavLink to={user?.permissions?.includes("pipeline.monitor") ? "/admin/pipeline" : "/overview"} onClick={() => setShowAllNavigation(false)} className="mb-5 block rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-xs font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-300">← Về trang chính</NavLink>}
        {shownGroups.map(group => <section key={group.label} className="mb-5" aria-label={group.label}>
          <h2 className="nav-group-title">{group.label}</h2>
          <div className="space-y-0.5">{group.items.map(item => {
            const Icon = icons[item.path] || Package
            return <NavLink key={item.path} to={item.path} title={item.unavailable || undefined} className={({ isActive }) => cn("nav-item", isActive && "nav-item-active")}>
              <Icon size={17} strokeWidth={1.8} className="shrink-0" aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className="block truncate">{item.label}</span>{item.unavailable && <span className="block text-[10px] font-normal text-slate-400">Chưa khả dụng</span>}</span>
              {item.unavailable && <span className="nav-item-pending" aria-label="Chưa khả dụng" title="Chưa khả dụng" />}
            </NavLink>
          })}</div>
        </section>)}
        <section aria-label="Tài khoản"><h2 className="nav-group-title">TÀI KHOẢN</h2><NavLink to="/settings" className={({ isActive }) => cn("nav-item", isActive && "nav-item-active")}><Settings2 size={17} strokeWidth={1.8} aria-hidden="true" /><span>Thiết lập cá nhân</span></NavLink></section>
      </nav>
      <div className="sidebar-account"><div className="account-avatar">{(user?.display_name || user?.email || "U").slice(0, 2).toUpperCase()}</div><div className="min-w-0 flex-1"><strong className="block truncate text-xs text-white">{user?.display_name || user?.email || "User"}</strong><span className="block truncate text-[11px] text-slate-400">{roleLabel}</span></div><Button variant="ghost" size="icon" className="text-slate-400 hover:bg-white/10 hover:text-white" onClick={logout} aria-label="Đăng xuất" title="Đăng xuất"><LogOut size={17} /></Button></div>
    </aside>

    <div ref={contentRef} className="app-content">
      <header className="app-topbar">
        <button ref={menuButtonRef} type="button" className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground lg:hidden" onClick={() => setMenu(true)} aria-label="Mở menu" aria-controls="app-navigation" aria-expanded={menu}><Menu size={21} /></button>
        <div className="min-w-0 flex-1"><div className="topbar-breadcrumb"><span>{currentGroup?.label || "KHÔNG GIAN LÀM VIỆC"}</span><ChevronRight size={12} aria-hidden="true" /><strong className="truncate">{current?.label || (location.pathname === "/settings" ? "Thiết lập cá nhân" : "Funnelmetry")}</strong></div><p className="topbar-subtitle hidden sm:block">{workspace} <span aria-hidden="true">·</span> {roleLabel}</p></div>
        <div className="topbar-actions">
          {user?.permissions?.includes("analytics.read") && <div className="range-select-wrap"><label className="sr-only" htmlFor="workspace-range">Khoảng thời gian phân tích</label><select id="workspace-range" value={range} onChange={event => setRange(event.target.value)}><option value="Last 7 days">7 ngày qua</option><option value="Last 30 days">30 ngày qua</option><option value="Last 90 days">90 ngày qua</option></select></div>}
          <ThemeSelect value={theme} onChange={value => void changeTheme(value)} disabled={themeSaving} />
        </div>
        {themeError && <p role="alert" className="absolute right-4 top-full mt-2 max-w-xs rounded-xl border border-destructive/30 bg-card p-3 text-xs text-destructive shadow-lg">{themeError}</p>}
      </header>
      <main ref={mainRef} id="main-content" tabIndex={-1} className="app-main"><div key={location.pathname} className="page-enter mx-auto max-w-[1540px]"><Outlet context={{ range, workspace, sourceId: analyticsSourceId } satisfies ShellContext} /></div></main>
    </div>
  </div>
}
