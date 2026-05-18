import { useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { useAuth } from './AuthContext'
import { Lock, User, Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react'

export default function LoginPage() {
  const { login, isAuthenticated, isLoading: authLoading } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Loader2 size={32} className="animate-spin text-indigo-400" />
      </div>
    )
  }
  if (isAuthenticated) {
    return <Navigate to="/dashboard" replace />
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await login(username, password)
      toast.success(`Welcome back, ${username}!`)
      navigate('/dashboard', { replace: true })
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Login failed'
      setError(msg)
      toast.error(msg)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      {/* Background aurora */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-96 h-96 bg-indigo-500/20 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-violet-500/20 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl" />
      </div>

      <div className="relative w-full max-w-md">
        {/* Logo & Branding */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-2xl shadow-lg shadow-indigo-500/40 mb-4">
            <span className="text-white font-bold text-2xl tracking-tight">RT</span>
          </div>
          <h1 className="text-2xl font-bold text-gradient">Realtime Dashboard</h1>
          <p className="text-slate-500 mt-1">E-commerce Data Processing Pipeline</p>
        </div>

        {/* Login Card */}
        <div className="glass-strong rounded-2xl shadow-2xl shadow-slate-950/60 ring-1 ring-indigo-500/20 p-8">
          <div className="text-center mb-6">
            <h2 className="text-xl font-semibold text-slate-100">Welcome back</h2>
            <p className="text-sm text-slate-500 mt-1">Sign in to your account</p>
          </div>

          {error && (
            <div className="mb-4 flex items-center gap-2 p-3 bg-rose-500/10 ring-1 ring-rose-500/30 rounded-lg text-sm text-rose-300">
              <AlertCircle size={16} className="flex-shrink-0" />
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label htmlFor="username" className="block text-sm font-medium text-slate-300 mb-1.5">
                Username
              </label>
              <div className="relative">
                <User size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  id="username"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 bg-slate-900/50 ring-1 ring-slate-700/60 text-slate-100 placeholder-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/60 transition"
                  placeholder="Enter your username"
                  autoComplete="username"
                  required
                  disabled={loading}
                />
              </div>
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-slate-300 mb-1.5">
                Password
              </label>
              <div className="relative">
                <Lock size={18} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-12 py-2.5 bg-slate-900/50 ring-1 ring-slate-700/60 text-slate-100 placeholder-slate-600 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/60 transition"
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                  disabled={loading}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading || !username || !password}
              className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-indigo-500 to-violet-600 text-white rounded-lg text-sm font-medium hover:shadow-lg hover:shadow-indigo-500/40 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {loading ? (
                <>
                  <Loader2 size={18} className="animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign in'
              )}
            </button>
          </form>

          {/* Demo credentials */}
          <div className="mt-6 pt-6 border-t border-slate-800/60">
            <p className="text-xs text-slate-500 text-center mb-3">Demo accounts</p>
            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => { setUsername('admin'); setPassword('admin123') }}
                className="p-2.5 bg-slate-800/40 hover:bg-slate-800/70 ring-1 ring-slate-700/40 rounded-lg text-xs text-slate-300 transition text-center"
                disabled={loading}
              >
                <div className="font-semibold">Admin</div>
                <div className="text-slate-500 mt-0.5">admin / admin123</div>
              </button>
              <button
                onClick={() => { setUsername('viewer'); setPassword('viewer123') }}
                className="p-2.5 bg-slate-800/40 hover:bg-slate-800/70 ring-1 ring-slate-700/40 rounded-lg text-xs text-slate-300 transition text-center"
                disabled={loading}
              >
                <div className="font-semibold">Viewer</div>
                <div className="text-slate-500 mt-0.5">viewer / viewer123</div>
              </button>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          Real-time E-commerce Data Streaming &amp; Processing Pipeline
        </p>
      </div>
    </div>
  )
}
