import { lazy, Suspense } from "react"
import { Navigate, Route, Routes, useLocation } from "react-router-dom"
import { AppShell } from "./AppShell"
import { LoginPage } from "../features/auth/LoginPage"
import { useAuth } from "../auth/AuthContext"

const OverviewPage = lazy(() => import("../features/overview/OverviewPage").then((module) => ({ default: module.OverviewPage })))
const FunnelsPage = lazy(() => import("../features/funnels/FunnelsPage").then((module) => ({ default: module.FunnelsPage })))
const JourneysPage = lazy(() => import("../features/journeys/JourneysPage").then((module) => ({ default: module.JourneysPage })))
const SessionPage = lazy(() => import("../features/sessions/SessionPage").then((module) => ({ default: module.SessionPage })))
const ProductsPage = lazy(() => import("../features/products/ProductsPage").then((module) => ({ default: module.ProductsPage })))
const EventsPage = lazy(() => import("../features/events/EventsPage").then((module) => ({ default: module.EventsPage })))
const DataHealthPage = lazy(() => import("../features/data-health/DataHealthPage").then((module) => ({ default: module.DataHealthPage })))
const InsightsPage = lazy(() => import("../features/insights/InsightsPage").then((module) => ({ default: module.InsightsPage })))
const SettingsPage = lazy(() => import("../features/settings/SettingsPage").then((module) => ({ default: module.SettingsPage })))

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
          <Route index element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/funnels" element={<FunnelsPage />} />
          <Route path="/journeys" element={<JourneysPage />} />
          <Route path="/sessions/:sessionId" element={<SessionPage />} />
          <Route path="/products" element={<ProductsPage />} />
          <Route path="/events" element={<EventsPage />} />
          <Route path="/data-health" element={<DataHealthPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/overview" replace />} />
      </Routes>
    </Suspense>
  )
}
