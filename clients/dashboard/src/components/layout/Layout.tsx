import { Outlet, NavLink } from 'react-router-dom'
import { LayoutDashboard, FileText, Settings, LogOut, User } from 'lucide-react'
import { useAuth } from '@/features/auth/AuthContext'

export default function Layout() {
  const { user, logout } = useAuth()

  const navLinks = [
    { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/events', label: 'Events', icon: FileText },
    { to: '/ops', label: 'Ops', icon: Settings },
  ]

  return (
    <div className="min-h-screen text-slate-100">
      {/* Header */}
      <header className="glass-strong border-b border-slate-800/60 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-500/30">
                <span className="text-white font-bold text-lg tracking-tight">RT</span>
              </div>
              <div>
                <h1 className="text-lg font-bold text-gradient leading-tight">Realtime Dashboard</h1>
                <p className="text-[11px] text-slate-500 leading-tight">E-commerce Data Processing</p>
              </div>
            </div>

            <nav className="flex gap-1">
              {navLinks.map(({ to, label, icon: Icon }) => (
                <NavLink
                  key={to}
                  to={to}
                  className={({ isActive }) =>
                    `flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                      isActive
                        ? 'bg-gradient-to-r from-indigo-500/20 to-violet-500/20 text-indigo-300 shadow-inner ring-1 ring-indigo-500/30'
                        : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                    }`
                  }
                >
                  <Icon size={16} />
                  {label}
                </NavLink>
              ))}
            </nav>

            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-800/60 rounded-lg ring-1 ring-slate-700/50">
                <div className="w-7 h-7 bg-gradient-to-br from-indigo-500 to-violet-600 rounded-full flex items-center justify-center">
                  <User size={13} className="text-white" />
                </div>
                <div className="hidden sm:block">
                  <div className="text-sm font-medium text-slate-100 leading-tight">{user?.displayName}</div>
                  <div className="text-[11px] text-slate-500 capitalize leading-tight">{user?.role}</div>
                </div>
              </div>
              <button
                onClick={logout}
                className="flex items-center gap-1.5 px-3 py-2 text-sm text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-all"
                title="Sign out"
              >
                <LogOut size={16} />
                <span className="hidden sm:inline">Logout</span>
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  )
}
