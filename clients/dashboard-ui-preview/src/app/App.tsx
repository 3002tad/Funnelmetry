import { Navigate, Route, Routes } from "react-router-dom"
import { AppShell } from "./AppShell"
import { OverviewPage } from "../features/overview/OverviewPage"
import { FunnelsPage } from "../features/funnels/FunnelsPage"
import { JourneysPage } from "../features/journeys/JourneysPage"
import { SessionPage } from "../features/sessions/SessionPage"
import { ProductsPage } from "../features/products/ProductsPage"
import { EventsPage } from "../features/events/EventsPage"
import { DataHealthPage } from "../features/data-health/DataHealthPage"
import { InsightsPage } from "../features/insights/InsightsPage"
import { SettingsPage } from "../features/settings/SettingsPage"

export function App() {
  return (
    <Routes>
      <Route element={<AppShell />}>
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
  )
}
