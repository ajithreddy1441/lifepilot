import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, User } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { Spinner } from '../components/ui';
import { AuthShell, PasswordInput } from './Login';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' });
  const [agree, setAgree] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (form.password !== form.confirm) return setError('Passwords do not match');
    if (!agree) return setError('Please accept the terms to continue');
    setBusy(true);
    setError('');
    try {
      await register({ name: form.name, email: form.email, password: form.password });
      navigate('/welcome');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Create Account" subtitle="Start your journey to a better you">
      <form onSubmit={submit} className="space-y-4">
        <label className="block">
          <span className="label">Name</span>
          <div className="relative">
            <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-10" value={form.name} onChange={set('name')} placeholder="Ajith Kumar" autoComplete="name" required />
          </div>
        </label>
        <label className="block">
          <span className="label">Email</span>
          <div className="relative">
            <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input type="email" className="input pl-10" value={form.email} onChange={set('email')} placeholder="ajith@example.com" autoComplete="email" required />
          </div>
        </label>
        <label className="block">
          <span className="label">Password</span>
          <PasswordInput value={form.password} onChange={set('password')} autoComplete="new-password" placeholder="At least 8 characters" />
        </label>
        <label className="block">
          <span className="label">Confirm password</span>
          <PasswordInput value={form.confirm} onChange={set('confirm')} autoComplete="new-password" />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-500">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="h-4 w-4 accent-brand-500" />
          I agree to the Terms &amp; Privacy Policy
        </label>
        {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600 dark:bg-rose-500/10 dark:text-rose-300">{error}</p>}
        <button className="btn-primary w-full py-3" disabled={busy}>
          {busy && <Spinner size={16} />} Create Account
        </button>
      </form>
      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{' '}
        <Link to="/login" className="font-semibold text-brand-600 dark:text-brand-300">Sign In</Link>
      </p>
    </AuthShell>
  );
}
