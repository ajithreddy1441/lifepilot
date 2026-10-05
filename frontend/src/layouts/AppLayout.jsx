import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, Link } from 'react-router-dom';
import {
  LayoutDashboard, CalendarDays, CalendarRange, ListTodo, AlarmClock, Bot, Repeat, Target, BarChart3, Moon, Sun, Settings, Mic, Smartphone, ClipboardCheck, Bell, Menu, X, Shield,
} from 'lucide-react';
import { Logo, ErrorBoundary } from '../components/ui';
import NotificationBell from '../features/notifications/NotificationBell';
import InstallPrompt from '../components/InstallPrompt';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useVoice } from '../features/voice/VoiceContext';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/today', label: 'Today', icon: CalendarDays },
  { to: '/planner', label: 'Planner', icon: CalendarRange },
  { to: '/tasks', label: 'Tasks', icon: ListTodo },
  { to: '/alarms', label: 'Alarms', icon: AlarmClock },
  { to: '/assistant', label: 'AI Assistant', icon: Bot },
  { to: '/habits', label: 'Habits', icon: Repeat },
  { to: '/goals', label: 'Goals', icon: Target },
  { to: '/review', label: 'Reviews', icon: ClipboardCheck },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/devices', label: 'Devices', icon: Smartphone },
  { to: '/settings', label: 'Settings', icon: Settings },
  { to: '/admin', label: 'Admin', icon: Shield, admin: true },
];

const MOBILE_NAV = [
  { to: '/', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/planner', label: 'Planner', icon: CalendarRange },
  null, // mic slot
  { to: '/tasks', label: 'Tasks', icon: ListTodo },
  { to: '/alarms', label: 'Alarms', icon: AlarmClock },
];

function SideLink({ to, label, icon: Icon, end }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition ${isActive ? 'bg-gradient-to-r from-brand-500 to-violet-500 text-white shadow-lg shadow-brand-500/25' : 'text-slate-500 hover:bg-slate-100 hover:text-slate-800 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white'}`
      }
    >
      <Icon size={18} /> {label}
    </NavLink>
  );
}

export default function AppLayout() {
  const { user } = useAuth();
  const { isDark, setTheme } = useTheme();
  const { openVoice } = useVoice();
  const location = useLocation();
  const title = NAV.find((n) => (n.end ? location.pathname === n.to : location.pathname.startsWith(n.to)))?.label;
  const nav = NAV.filter((n) => !n.admin || user?.role === 'admin');
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [location.pathname]);

  return (
    <div className="min-h-screen md:flex">
      {menu && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 backdrop-blur-sm md:hidden" onClick={() => setMenu(false)}>
          <aside className="flex h-full w-72 flex-col bg-white px-4 py-5 animate-slide-up dark:bg-ink-950" style={{ paddingTop: 'max(1.25rem, env(safe-area-inset-top))' }} onClick={(e) => e.stopPropagation()}>
            <div className="mb-6 flex items-center justify-between px-2">
              <Logo />
              <button onClick={() => setMenu(false)} className="rounded-lg p-1.5 text-slate-400" aria-label="Close menu"><X size={20} /></button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto">
              {nav.map((n) => <SideLink key={n.to} {...n} />)}
            </nav>
          </aside>
        </div>
      )}
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-slate-200/70 bg-white/70 px-4 py-5 backdrop-blur md:flex dark:border-white/5 dark:bg-ink-950/60">
        <Link to="/" className="mb-6 px-2">
          <Logo />
        </Link>
        <nav className="flex-1 space-y-1 overflow-y-auto scrollbar-none">
          {nav.map((n) => (
            <SideLink key={n.to} {...n} />
          ))}
        </nav>
        <Link to="/settings" className="mt-4 flex items-center gap-3 rounded-xl p-2 hover:bg-slate-100 dark:hover:bg-white/5">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-violet-500 text-sm font-bold text-white">{user?.name?.[0]?.toUpperCase()}</span>
          <span className="min-w-0">
            <span className="block truncate text-sm font-bold">{user?.name}</span>
            <span className="block truncate text-xs text-slate-400">{user?.timezone}</span>
          </span>
        </Link>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200/60 bg-[#f5f4ff]/80 px-4 py-2.5 backdrop-blur-md md:px-8 dark:border-white/5 dark:bg-ink-900/80" style={{ paddingTop: 'max(0.625rem, env(safe-area-inset-top))' }}>
          <button onClick={() => setMenu(true)} className="-ml-1 rounded-xl p-2 text-slate-600 md:hidden dark:text-slate-300" aria-label="Open menu">
            <Menu size={22} />
          </button>
          <h2 className="flex-1 truncate text-base font-bold md:text-lg">{title}</h2>
          <button onClick={() => setTheme(isDark ? 'light' : 'dark')} className="rounded-xl p-2.5 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5" aria-label="Toggle dark mode">
            {isDark ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <ErrorBoundary>
            <NotificationBell />
          </ErrorBoundary>
          <Link to="/settings" className="md:hidden">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-sky-400 to-violet-500 text-sm font-bold text-white">{user?.name?.[0]?.toUpperCase()}</span>
          </Link>
        </header>

        <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-32 pt-5 md:px-8 md:pb-12">
          <InstallPrompt />
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>

      {/* Desktop floating mic */}
      <button onClick={openVoice} className="fixed bottom-8 right-8 z-40 hidden h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 via-brand-500 to-fuchsia-500 text-white shadow-2xl shadow-brand-500/40 transition hover:scale-105 md:flex" aria-label="Voice assistant">
        <Mic size={26} />
      </button>

      {/* Mobile bottom navigation with large centre mic */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/70 bg-white/95 backdrop-blur md:hidden dark:border-white/5 dark:bg-ink-950/95">
        <div className="relative grid grid-cols-5 items-end px-2 pt-1.5">
          {MOBILE_NAV.map((n, i) =>
            n ? (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => `flex flex-col items-center gap-0.5 py-1.5 text-[11px] font-semibold ${isActive ? 'text-brand-600 dark:text-brand-300' : 'text-slate-400'}`}>
                <n.icon size={22} />
                {n.label}
              </NavLink>
            ) : (
              <div key={`mic-${i}`} className="flex justify-center">
                <button onClick={openVoice} className="-mt-8 flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-sky-500 via-brand-500 to-fuchsia-500 text-white shadow-xl shadow-brand-500/40 ring-4 ring-[#f5f4ff] active:scale-95 dark:ring-ink-900" aria-label="Voice assistant">
                  <Mic size={28} />
                </button>
              </div>
            ),
          )}
        </div>
      </nav>
    </div>
  );
}
