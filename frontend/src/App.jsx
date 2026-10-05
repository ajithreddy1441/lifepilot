import { lazy, Suspense, useEffect } from 'react';
import { Navigate, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AppLayout from './layouts/AppLayout';
import { PageLoader, Logo } from './components/ui';
import { VoiceProvider } from './features/voice/VoiceContext';
import { AssistantResultProvider } from './features/assistant/AssistantResult';
import { on } from './services/bus';
import { isAndroidApp } from './services/native/platform';
import { initNativeAlarms, syncAlarms, scheduleTestAlarm } from './services/native/alarmSync';
import Login from './pages/Login';
import Register from './pages/Register';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Today = lazy(() => import('./pages/Today'));
const Planner = lazy(() => import('./pages/Planner'));
const Tasks = lazy(() => import('./pages/Tasks'));
const Alarms = lazy(() => import('./pages/Alarms'));
const Assistant = lazy(() => import('./pages/Assistant'));
const Habits = lazy(() => import('./pages/Habits'));
const Goals = lazy(() => import('./pages/Goals'));
const Review = lazy(() => import('./pages/Review'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Notifications = lazy(() => import('./pages/Notifications'));
const Devices = lazy(() => import('./pages/Devices'));
const Settings = lazy(() => import('./pages/Settings'));
const Onboarding = lazy(() => import('./pages/Onboarding'));
const Admin = lazy(() => import('./pages/Admin'));

function Splash() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-ink-900 text-white">
      <img src="/logo-full.png" alt="LifePilot AI" className="w-56 animate-pulse" />
      <div className="mt-8 h-1 w-40 overflow-hidden rounded-full bg-white/10">
        <div className="h-full w-1/2 animate-[pulse_1.2s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-sky-400 via-brand-500 to-fuchsia-500" />
      </div>
    </div>
  );
}

function NativeBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isAndroidApp) return undefined;
    initNativeAlarms(navigate);
    const offs = [
      on('server:sync', (p) => {
        if (p?.test_alarm_id) scheduleTestAlarm(3, 'Test alarm from website');
        syncAlarms('sse');
      }),
      on('server:alarms_changed', (p) => p?.reason !== 'device_synced' && syncAlarms('sse')),
    ];
    return () => offs.forEach((o) => o());
  }, [navigate]);

  // Service worker asks the page to navigate after a notification click.
  useEffect(() => {
    const onMsg = (e) => e.data?.type === 'navigate' && navigate(e.data.url);
    navigator.serviceWorker?.addEventListener('message', onMsg);
    return () => navigator.serviceWorker?.removeEventListener('message', onMsg);
  }, [navigate]);
  return null;
}

export default function App() {
  const { user, preferences, loading } = useAuth();

  if (loading) return <Splash />;

  if (!user) {
    return (
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="*" element={<Login />} />
      </Routes>
    );
  }

  return (
    <VoiceProvider>
      <AssistantResultProvider>
        <NativeBridge />
        <Suspense fallback={<PageLoader />}>
          <Routes>
            <Route path="/welcome" element={<Onboarding />} />
            <Route element={<AppLayout />}>
              <Route index element={preferences && !preferences.onboarded && user.role !== 'admin' ? <Navigate to="/welcome" replace /> : <Dashboard />} />
              <Route path="today" element={<Today />} />
              <Route path="planner" element={<Planner />} />
              <Route path="tasks" element={<Tasks />} />
              <Route path="alarms" element={<Alarms />} />
              <Route path="assistant" element={<Assistant />} />
              <Route path="habits" element={<Habits />} />
              <Route path="goals" element={<Goals />} />
              <Route path="review" element={<Review />} />
              <Route path="analytics" element={<Analytics />} />
              <Route path="notifications" element={<Notifications />} />
              <Route path="devices" element={<Devices />} />
              <Route path="settings" element={<Settings />} />
              <Route path="admin" element={user.role === 'admin' ? <Admin /> : <Navigate to="/" replace />} />
              <Route path="login" element={<Navigate to="/" replace />} />
              <Route path="register" element={<Navigate to="/" replace />} />
              <Route
                path="*"
                element={
                  <div className="py-20 text-center">
                    <Logo className="justify-center" />
                    <p className="mt-6 text-slate-500">Page not found.</p>
                  </div>
                }
              />
            </Route>
          </Routes>
        </Suspense>
      </AssistantResultProvider>
    </VoiceProvider>
  );
}
