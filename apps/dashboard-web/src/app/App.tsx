import { lazy, Suspense } from "react"
import { Navigate, Outlet, Route, Routes, useLocation, useOutletContext } from "react-router-dom"
import { AppShell, type ShellContext } from "./AppShell"
import { LoginPage } from "../features/auth/LoginPage"
import { useAuth } from "../auth/AuthContext"
import { navigation } from './navigation'
import { UnavailablePage } from './UnavailablePage'

const OverviewPage = lazy(() => import("../features/overview/OverviewPage").then((module) => ({ default: module.OverviewPage })))
const FunnelsPage = lazy(() => import("../features/funnels/FunnelsPage").then((module) => ({ default: module.FunnelsPage })))
const JourneysPage = lazy(() => import("../features/journeys/JourneysPage").then((module) => ({ default: module.JourneysPage })))
const SessionPage = lazy(() => import("../features/sessions/SessionPage").then((module) => ({ default: module.SessionPage })))
const EventsPage = lazy(() => import("../features/events/EventsPage").then((module) => ({ default: module.EventsPage })))
const DataHealthPage = lazy(() => import("../features/data-health/DataHealthPage").then((module) => ({ default: module.DataHealthPage })))
const SettingsPage = lazy(() => import("../features/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })))
const AdminUsersPage = lazy(() => import('../features/admin/AdminUsersPage'))
const PipelineHealthPage = lazy(() => import('../features/admin/PipelineHealthPage'))
const SourcesPage = lazy(() => import('../features/admin/SourcesPage'))
const ChatPage = lazy(() => import('../features/chat/ChatPage').then(module => ({ default: module.ChatPage })))
const CatalogPage = lazy(() => import('../features/catalog/CatalogPage'))
const EvidencePage = lazy(() => import('../features/evidence/EvidencePage'))
const FindingsPage = lazy(() => import('../features/evidence/FindingsPage'))
const AuditPage = lazy(() => import('../features/admin/AuditPage'))
const ConnectorsPage = lazy(() => import('../features/admin/ConnectorsPage'))
const QuarantinePage = lazy(() => import('../features/admin/QuarantinePage'))
const WorkspacePage = lazy(() => import('../features/workspace/WorkspacePage'))
const ProductObservationsPage = lazy(() => import('../features/products/ProductObservationsPage'))

function Landing() {
  const { user } = useAuth()
  if (!user) return <PageFallback />
  if (user.permissions?.includes('pipeline.monitor')) return <Navigate to="/admin/pipeline" replace />
  if (user.permissions?.includes('analytics.read')) return <Navigate to="/overview" replace />
  return <p className="panel p-6">Tài khoản chưa có quyền truy cập. Hãy liên hệ quản trị viên.</p>
}

function PermissionGate({ permission }: { permission: string }) {
  const { user } = useAuth()
  const context = useOutletContext<ShellContext>()
  if (!user) return <PageFallback />
  return user.permissions?.includes(permission) ? <Outlet context={context} /> : <Navigate to="/" replace />
}

function PageFallback() {
  return <div className="space-y-4"><div className="skeleton h-16 w-96 max-w-full" /><div className="skeleton h-[520px]" /></div>
}

function ProtectedShell() {
  const { token } = useAuth()
  const location = useLocation()
  return token ? <AppShell /> : <Navigate to="/login" replace state={{ from: location.pathname }} />
}

export function App() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route element={<ProtectedShell />}>
          <Route index element={<Landing />} />
          <Route element={<PermissionGate permission="analytics.read" />}>
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/funnels" element={<FunnelsPage />} />
          <Route path="/journeys" element={<JourneysPage />} />
          <Route path="/sessions/:sessionId" element={<SessionPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/metrics" element={<CatalogPage kind="metrics" />} />
          <Route path="/assets" element={<CatalogPage kind="assets" />} />
          <Route path="/analysis-runs" element={<EvidencePage runs />} />
          <Route path="/workspace" element={<WorkspacePage />} />
          <Route path="/products" element={<ProductObservationsPage />} />
          <Route path="/evidence" element={<EvidencePage />} />
          <Route path="/reports" element={<EvidencePage reports />} />
          <Route path="/findings" element={<FindingsPage />} />
          <Route path="/data-health" element={<DataHealthPage />} />
          <Route path="/insights" element={<Navigate to="/findings" replace />} />
          <Route element={<PermissionGate permission="chat.use" />}>
            <Route path="/chat" element={<ChatPage />} />
          </Route>
          </Route>
          <Route element={<PermissionGate permission="pipeline.monitor" />}>
          <Route path="/admin/pipeline" element={<PipelineHealthPage />} />
          <Route path="/admin/connector" element={<ConnectorsPage />} />
          <Route path="/admin/quarantine" element={<QuarantinePage />} />
          </Route>
          <Route element={<PermissionGate permission="audit.read" />}>
            <Route path="/admin/audit" element={<AuditPage />} />
          </Route>
          <Route element={<PermissionGate permission="user.manage" />}>
            <Route path="/admin/users" element={<AdminUsersPage />} />
          </Route>
          <Route element={<PermissionGate permission="integration.read" />}>
            <Route path="/admin/sources" element={<SourcesPage />} />
          </Route>
          <Route path="/settings" element={<SettingsPage />} />
          {navigation.flatMap(group => group.items).filter(item => item.unavailable).map(item =>
            <Route key={item.path} element={<PermissionGate permission={item.permission} />}>
              <Route path={item.path} element={<UnavailablePage item={item} />} />
            </Route>,
          )}
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
