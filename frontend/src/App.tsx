import { Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/layout/Layout'
import Dashboard from './features/dashboard/Dashboard'
import Events from './features/events/Events'
import Ops from './features/ops/Ops'

function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Navigate to="/dashboard" replace />} />
        <Route path="dashboard" element={<Dashboard />} />
        <Route path="events" element={<Events />} />
        <Route path="ops" element={<Ops />} />
      </Route>
    </Routes>
  )
}

export default App
