import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sunrise, Moon, Briefcase, Dumbbell, Bell, ArrowRight, ArrowLeft } from 'lucide-react';
import { api } from '../services/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { Field, Logo, DayPicker, Segmented, Spinner } from '../components/ui';
import { enablePush, pushSupported } from '../services/push';

const STEPS = ['Welcome', 'Your day', 'Work', 'Preferences', 'Notifications'];

export default function Onboarding() {
  const { preferences, setPreferences, user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [p, setP] = useState({
    wake_time: preferences?.wake_time || '06:30',
    sleep_time: preferences?.sleep_time || '23:00',
    work_start: preferences?.work_start || '09:30',
    work_end: preferences?.work_end || '18:30',
    work_days: preferences?.work_days || ['MON', 'TUE', 'WED', 'THU', 'FRI'],
    preferred_workout_time: preferences?.preferred_workout_time || 'morning',
    preferred_creative_time: preferences?.preferred_creative_time || 'night',
    preferred_freelance_time: preferences?.preferred_freelance_time || 'evening',
  });
  const set = (k) => (v) => setP((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));

  const finish = async () => {
    setBusy(true);
    try {
      const { preferences: saved } = await api.put('/settings/preferences', { ...p, onboarded: true });
      setPreferences(saved);
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const notify = async () => {
    const r = await enablePush().catch((e) => e.message);
    if (r === 'granted') toast('Notifications enabled on this browser');
    else if (r === 'denied') toast.error('Notifications are blocked. You can enable them later in your browser’s site settings.');
    else if (r === 'server-unconfigured') toast.info('The server has no VAPID keys yet — in-app notifications still work.');
    else if (typeof r === 'string' && r !== 'default') toast.info(r === 'unsupported' ? 'This browser does not support web push.' : r);
  };

  const timeOpts = (opts) => opts.map((o) => ({ value: o, label: o[0].toUpperCase() + o.slice(1) }));

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#eef0ff] to-[#f8eeff] p-4 dark:from-ink-950 dark:to-ink-900">
      <div className="card w-full max-w-lg p-6 md:p-8">
        <div className="mb-6 flex items-center justify-between">
          <Logo size={32} />
          <span className="text-xs font-semibold text-slate-400">{step + 1} / {STEPS.length}</span>
        </div>
        <div className="mb-6 flex gap-1.5">
          {STEPS.map((s, i) => (
            <span key={s} className={`h-1.5 flex-1 rounded-full ${i <= step ? 'bg-gradient-to-r from-brand-500 to-violet-500' : 'bg-slate-200 dark:bg-ink-700'}`} />
          ))}
        </div>

        {step === 0 && (
          <div className="text-center">
            <img src="/logo-full.png" alt="" className="mx-auto w-44 rounded-3xl bg-ink-900 p-3" />
            <h1 className="mt-6 text-2xl font-extrabold">Hi {user?.name?.split(' ')[0]} 👋</h1>
            <p className="mt-2 text-slate-500 dark:text-slate-400">Let’s set up your planner in under a minute so I can schedule things at the right times — and protect your sleep.</p>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <h2 className="text-xl font-bold">When does your day start and end?</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label={<span className="flex items-center gap-1"><Sunrise size={14} /> Wake up</span>}>
                <input type="time" className="input" value={p.wake_time} onChange={set('wake_time')} />
              </Field>
              <Field label={<span className="flex items-center gap-1"><Moon size={14} /> Sleep</span>}>
                <input type="time" className="input" value={p.sleep_time} onChange={set('sleep_time')} />
              </Field>
            </div>
            <p className="text-xs text-slate-400">I won’t schedule anything outside these hours without warning you.</p>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-4">
            <h2 className="flex items-center gap-2 text-xl font-bold"><Briefcase size={20} /> Your main job</h2>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Work starts">
                <input type="time" className="input" value={p.work_start} onChange={set('work_start')} />
              </Field>
              <Field label="Work ends">
                <input type="time" className="input" value={p.work_end} onChange={set('work_end')} />
              </Field>
            </div>
            <Field label="Work days">
              <DayPicker value={p.work_days} onChange={set('work_days')} />
            </Field>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-5">
            <h2 className="flex items-center gap-2 text-xl font-bold"><Dumbbell size={20} /> When do you prefer…</h2>
            <Field label="Workouts">
              <Segmented value={p.preferred_workout_time} onChange={set('preferred_workout_time')} options={timeOpts(['morning', 'afternoon', 'evening'])} />
            </Field>
            <Field label="Creative work (writing, stories)">
              <Segmented value={p.preferred_creative_time} onChange={set('preferred_creative_time')} options={timeOpts(['morning', 'afternoon', 'evening', 'night'])} />
            </Field>
            <Field label="Freelancing">
              <Segmented value={p.preferred_freelance_time} onChange={set('preferred_freelance_time')} options={timeOpts(['morning', 'afternoon', 'evening', 'night'])} />
            </Field>
          </div>
        )}

        {step === 4 && (
          <div className="space-y-4 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-50 text-brand-500 dark:bg-brand-500/10">
              <Bell size={30} />
            </div>
            <h2 className="text-xl font-bold">Never miss what matters</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400">Allow notifications so reminders reach this browser even when the tab is closed. For alarms that ring your phone, install the Android app and sign in — it syncs automatically.</p>
            {pushSupported() && (
              <button className="btn-secondary mx-auto" onClick={notify}>
                <Bell size={16} /> Enable browser notifications
              </button>
            )}
          </div>
        )}

        <div className="mt-8 flex justify-between">
          <button className="btn-ghost" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            <ArrowLeft size={16} /> Back
          </button>
          {step < STEPS.length - 1 ? (
            <button className="btn-primary" onClick={() => setStep((s) => s + 1)}>
              Next <ArrowRight size={16} />
            </button>
          ) : (
            <button className="btn-primary" onClick={finish} disabled={busy}>
              {busy && <Spinner size={16} />} Get started
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
