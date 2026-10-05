import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Eye, EyeOff, Mail, Lock } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Spinner } from '../components/ui';

export function AuthShell({ children, title, subtitle }) {
  return (
    <div className="flex min-h-screen">
      <div className="relative hidden flex-1 flex-col items-center justify-center overflow-hidden bg-ink-900 p-12 text-white lg:flex">
        <div className="absolute -left-20 -top-20 h-96 w-96 rounded-full bg-brand-600/30 blur-3xl" />
        <div className="absolute -bottom-32 right-0 h-96 w-96 rounded-full bg-fuchsia-600/20 blur-3xl" />
        <img src="/logo-full.png" alt="LifePilot AI" className="relative w-72" />
        <p className="relative mt-8 max-w-sm text-center text-lg text-slate-300">Your AI planning partner. Tell it what you need to do — it finds the time, reminds you, and rings your phone.</p>
        <div className="relative mt-10 grid grid-cols-3 gap-4 text-center text-xs text-slate-400">
          <div className="rounded-2xl bg-white/5 p-4"><div className="text-2xl">🎙️</div>Voice</div>
          <div className="rounded-2xl bg-white/5 p-4"><div className="text-2xl">🧠</div>Smart scheduling</div>
          <div className="rounded-2xl bg-white/5 p-4"><div className="text-2xl">⏰</div>Phone alarms</div>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center">
            <img src="/icons/icon.svg" alt="" className="h-16 w-16 rounded-2xl shadow-lg shadow-brand-500/30" />
            <h1 className="mt-4 text-2xl font-extrabold">
              LifePilot <span className="gradient-text">AI</span>
            </h1>
            <p className="mt-6 text-xl font-bold">{title}</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

export function PasswordInput({ value, onChange, placeholder = '••••••••', autoComplete }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Lock size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
      <input type={show ? 'text' : 'password'} className="input pl-10 pr-10" value={value} onChange={onChange} placeholder={placeholder} autoComplete={autoComplete} required />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Welcome Back!" subtitle="Sign in to continue your journey">
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="label">Email</span>
          <div className="relative">
            <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="email" className="input pl-10" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ajith@example.com" autoComplete="email" required />
          </div>
        </label>
        <label className="block">
          <span className="label">Password</span>
          <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
        <button className="btn-primary w-full py-3" disabled={busy}>
          {busy && <Spinner size={16} />} Sign In
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Don&apos;t have an account?{' '}
        <Link to="/register" className="font-semibold text-brand-600 dark:text-brand-300">Sign Up</Link>
      </p>
    </AuthShell>
  );
}
