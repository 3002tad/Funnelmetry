import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './features/auth/AuthContext'
import ProtectedRoute from './features/auth/ProtectedRoute'
import LoginPage from './features/auth/LoginPage'
import Layout from './components/layout/Layout'
import ErrorBoundary from './components/ErrorBoundary'
import { Loader2 } from 'lucide-react'

// Lazy-load heavy page components for code splitting
const Dashboard = lazy(() => import('./features/dashboard/Dashboard'))
const Events = lazy(() => import('./features/events/Events'))
const Ops = lazy(() => import('./features/ops/Ops'))

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 size={32} className="animate-spin text-blue-600" />
    </div>
  )
}

function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
        <Routes>
          {/* Public route */}
          <Route path="/login" element={<LoginPage />} />

          {/* Protected routes */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          >
            <Route index element={<Navigate to="/dashboard" replace />} />
            <Route path="dashboard" element={<Suspense fallback={<PageLoader />}><Dashboard /></Suspense>} />
            <Route path="events" element={<Suspense fallback={<PageLoader />}><Events /></Suspense>} />
            <Route path="ops" element={<Suspense fallback={<PageLoader />}><Ops /></Suspense>} />
          </Route>

          {/* Catch-all */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </ErrorBoundary>
  )
}

export default App
