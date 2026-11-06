import { TemplateShell } from '../ui-template/TemplateShell'
import { defaultDateRange } from "../lib/date-range"
import { DateRangePicker } from "../components/ui/date-range-picker"
import { useEffect, useRef, useState } from "react"
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Outlet, useLocation, useNavigate } from "react-router-dom"
import { ChevronRight } from "lucide-react"
import { useAuth } from "../auth/AuthContext"
import { analyticsSourceId, apiRequest } from "../lib/api"
import { accountPreferencesKey, type PreferencesResponse } from "../lib/account-preferences"
import type { ThemePreference } from "./useThemePreference"
import { visibleNavigation } from "./navigation"
import { useThemePreference } from "./useThemePreference"
import { PageErrorBoundary } from "./PageErrorBoundary"
import { DesignDialog } from '../components/ui/design-dialog'

export type ShellContext = { range: string; setRange: (range:string)=>void; datasetLabel:string; setDatasetLabel:(label:string)=>void; workspace: string; sourceId: string; theme: ThemePreference; setThemePreference: (next: ThemePreference) => Promise<void> }


export function AppShell() {
  const location = useLocation()
  const navigate=useNavigate()
  const [collapsed,setCollapsed]=useState(false),[commandOpen,setCommandOpen]=useState(false),[command,setCommand]=useState(''),[notificationOpen,setNotificationOpen]=useState(false)
  const [menu, setMenu] = useState(false)
  const [range, setRange] = useState(defaultDateRange)
  const [datasetLabel,setDatasetLabel]=useState('Medusa Reference')
  const [theme, setTheme] = useThemePreference()
  const [themeSaving, setThemeSaving] = useState(false)
  const [themeError, setThemeError] = useState("")
  const { user, logout } = useAuth()
  const adminMode=location.pathname.startsWith('/admin')||user?.role==='super_admin'
  const workspace=import.meta.env.VITE_ANALYTICS_WORKSPACE_NAME||(adminMode?'System Administration':'Medusa Reference')
  const accountName=user?.display_name||user?.email||'U'
  const accountInitials=accountName.trim().split(/\s+/).length>1?accountName.trim().split(/\s+/).map(part=>part[0]).slice(0,2).join('').toUpperCase():accountName.slice(0,2).toUpperCase()
  const queryClient = useQueryClient()
  const preferences = useQuery({
    queryKey: accountPreferencesKey(user?.id),
    queryFn: ({ signal }) => apiRequest<PreferencesResponse>("/api/account/preferences", { signal }),
    enabled: Boolean(user?.id), retry: false, staleTime: 30_000,
  })
  const groups = visibleNavigation(user?.permissions || [])
  const inAi = location.pathname === "/ai"
  const labels: Record<string,string> = { "Tổng quan":"Overview", "Hành trình chuyển đổi":"Conversion journeys", "Sản phẩm":"Products", "Sự kiện":"Events", "Chất lượng dữ liệu":"Data quality", "Tổng quan Pipeline":"Pipeline overview", "Nguồn dữ liệu":"Data sources", "Điều tra sự kiện":"Event investigation", "Tài khoản & phân quyền":"Users & roles", "Audit tài khoản":"Account audit" }
  const shownGroups = preferences.data?.preferences.language === "en" ? groups.map(group=>({...group,items:group.items.map(item=>({...item,label:labels[item.label]||item.label}))})) : groups
  const sidebarRef = useRef<HTMLElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const closeButtonRef = useRef<HTMLButtonElement>(null)
  const menuButtonRef = useRef<HTMLButtonElement>(null)
  const mainRef = useRef<HTMLElement>(null)
  const current = groups.flatMap(group => group.items).find(item => item.path === location.pathname)
  useEffect(()=>{const handler=(e:KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setCommandOpen(v=>!v)}};window.addEventListener('keydown',handler);return()=>window.removeEventListener('keydown',handler)},[])

  useEffect(() => {
    if (!preferences.data || !user?.id) return
    setTheme(preferences.data.preferences.theme)
  }, [preferences.data, setTheme, user?.id])

  async function changeTheme(next: ThemePreference) {
    setTheme(next)
    setThemeError("")
    setThemeSaving(true)
    try {
      const saved = await apiRequest<PreferencesResponse>("/api/account/preferences", {
        method: "PATCH", body: JSON.stringify({ theme: next }),
      })
      queryClient.setQueryData(accountPreferencesKey(user?.id), saved)
    } catch {
      setThemeError("Đã đổi giao diện trên trình duyệt này, nhưng chưa lưu được vào tài khoản. Thử lại khi Dashboard API sẵn sàng.")
    } finally { setThemeSaving(false) }
  }

  function closeMenu() {
    setMenu(false)
    // The backdrop is removed on close; do not leave keyboard focus on it.
    requestAnimationFrame(() => menuButtonRef.current?.focus())
  }

  useEffect(() => { setMenu(false); mainRef.current?.focus({ preventScroll: true }) }, [location.pathname])
  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 761px)")
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
      if (event.key !== "Tab" || !sidebarRef.current || window.matchMedia("(min-width: 761px)").matches) return
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

  return <><TemplateShell admin={adminMode} inAi={inAi} workspace={workspace} label={current?.label||(location.pathname==='/settings'?'Thiết lập cá nhân':'Funnelmetry')} initials={accountInitials} name={accountName} menu={menu} collapsed={collapsed} dark={theme==='dark'} themeDisabled={themeSaving||preferences.isPending} themeError={themeError} groups={shownGroups} sidebarRef={sidebarRef} contentRef={contentRef} mainRef={mainRef} closeRef={closeButtonRef} menuRef={menuButtonRef} onCloseMenu={closeMenu} onMenu={()=>setMenu(true)} onCollapse={()=>setCollapsed(v=>!v)} onLogout={logout} onCommand={()=>{setCommand('');setCommandOpen(true)}} onNotifications={()=>setNotificationOpen(true)} onTheme={()=>void changeTheme(document.documentElement.classList.contains('dark')?'light':'dark')}>
    <PageErrorBoundary key={location.pathname}><Outlet context={{range,setRange,datasetLabel,setDatasetLabel,workspace,sourceId:analyticsSourceId,theme,setThemePreference:changeTheme} satisfies ShellContext}/></PageErrorBoundary>
  </TemplateShell>
    {commandOpen&&<DesignDialog title="Tìm trang / chức năng" onClose={()=>setCommandOpen(false)}><input className="tpl-command-input" autoComplete="off" aria-label="Tìm trang" placeholder="Tìm trang hoặc chức năng…" value={command} onChange={e=>setCommand(e.target.value)}/><div className="tpl-command-results">{[...shownGroups.flatMap(g=>g.items),{path:'/settings',label:'Thiết lập cá nhân'}].filter(item=>item.label.toLowerCase().includes(command.toLowerCase())).map(item=><button key={item.path} onClick={()=>{setCommandOpen(false);navigate(item.path)}}>{item.label}<ChevronRight size={14}/></button>)}</div></DesignDialog>}
    {notificationOpen&&<DesignDialog title="Thông báo workspace" onClose={()=>setNotificationOpen(false)}><p className="tpl-semantic-footnote">Hệ thống chưa cung cấp nguồn thông báo cho tài khoản này.</p></DesignDialog>}

  </>
}
