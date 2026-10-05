import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { LogOut, Plus, Trash2, Bell, BellOff, Pencil } from 'lucide-react';
import { api } from '../services/api';
import { emit } from '../services/bus';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import { useToast } from '../context/ToastContext';
import { useCategories } from '../hooks/useCategories';
import { Field, Toggle, DayPicker, Segmented, Spinner, Modal } from '../components/ui';
import { PasswordInput } from './Login';
import { DAYS } from '../utils/format';
import { SOUNDS } from '../features/alarms/AlarmForm';
import { DENIED_HELP } from '../features/notifications/PermissionBanner';
import { enablePush, disablePush, permissionState, pushSupported, currentSubscription } from '../services/push';
import { isNative } from '../services/native/platform';

const TIMEZONES = (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : ['Asia/Kolkata', 'UTC', 'America/New_York', 'Europe/London']).filter((z) => z.includes('/') || z === 'UTC');
const WINDOWS = ['morning', 'afternoon', 'evening', 'night'];
const NOTIF_TOGGLES = [
  ['upcoming_tasks', 'Upcoming tasks'],
  ['deadlines', 'Deadlines'],
  ['reminders', 'Reminders'],
  ['missed_tasks', 'Missed tasks'],
  ['daily_briefing', 'Daily briefing'],
  ['weekly_planning', 'Weekly planning reminder'],
  ['daily_review', 'Daily review prompt'],
  ['in_app', 'In-app notification center'],
  ['web_push', 'Browser push'],
  ['mobile_push', 'Phone push'],
];

function Section({ id, title, children }) {
  return (
    <section id={id} className="card scroll-mt-24 p-5">
      <h2 className="mb-4 text-lg font-extrabold">{title}</h2>
      {children}
    </section>
  );
}

export default function Settings() {
  const { user, preferences, setPreferences, updateUser, logout } = useAuth();
  const { theme, setTheme } = useTheme();
  const toast = useToast();
  const location = useLocation();
  const categories = useCategories();
  const { data: blocks, reload: reloadBlocks } = useApi(() => api.get('/schedule-blocks').then((r) => r.blocks), [], { initial: [] });
  const { data: notifPrefs, setData: setNotifPrefs } = useApi(() => api.get('/notifications/preferences').then((r) => r.preferences), []);
  const [name, setName] = useState(user.name);
  const [tz, setTz] = useState(user.timezone);
  const [moveAlarms, setMoveAlarms] = useState(true);
  const [prefs, setPrefs] = useState(preferences);
  const [pw, setPw] = useState({ current: '', next: '', confirm: '' });
  const [pushState, setPushState] = useState(permissionState());
  const [subscribed, setSubscribed] = useState(false);
  const [catForm, setCatForm] = useState(null);
  const [blockForm, setBlockForm] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => {
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView({ behavior: 'smooth' });
  }, [location.hash]);
  useEffect(() => { currentSubscription().then((s) => setSubscribed(!!s)); }, []);

  const saveProfile = async () => {
    setBusy('profile');
    try {
      const { user: u, moved_alarms: moved } = await api.put('/settings/profile', { name, timezone: tz, theme, move_alarms: moveAlarms });
      updateUser(u);
      if (moved) toast(`Timezone updated — ${moved} alarm${moved === 1 ? '' : 's'} keep the same local time`);
      else toast('Profile saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const savePrefs = async (patch = prefs) => {
    setBusy('prefs');
    try {
      const { preferences: saved } = await api.put('/settings/preferences', patch);
      setPreferences(saved);
      setPrefs(saved);
      toast('Preferences saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const saveNotif = async (patch) => {
    const next = { ...notifPrefs, ...patch };
    setNotifPrefs(next);
    try {
      const { preferences: saved } = await api.put('/notifications/preferences', patch);
      setNotifPrefs(saved);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const changePw = async (e) => {
    e.preventDefault();
    if (pw.next !== pw.confirm) return toast.error('New passwords do not match');
    setBusy('pw');
    try {
      await api.post('/auth/change-password', { current_password: pw.current, new_password: pw.next });
      setPw({ current: '', next: '', confirm: '' });
      toast('Password updated');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const togglePush = async () => {
    if (subscribed) {
      await disablePush();
      setSubscribed(false);
      setPushState(permissionState());
      toast.info('Browser push turned off on this device');
      return;
    }
    const r = await enablePush();
    setPushState(permissionState());
    setSubscribed(r === 'granted');
    if (r === 'granted') toast('Browser notifications enabled');
    else if (r === 'denied') toast.error(DENIED_HELP);
    else if (r === 'server-unconfigured') toast.info('The server has no VAPID keys yet');
    else if (r === 'unsupported') toast.info('This browser does not support web push');
  };

  const setP = (k) => (v) => setPrefs((p) => ({ ...p, [k]: v?.target ? v.target.value : v }));

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-2xl font-extrabold">Settings</h1>

      <Section title="Profile">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Email"><input className="input" value={user.email} disabled /></Field>
          <Field label="Timezone" hint="Alarms keep the same clock time when you travel" className="sm:col-span-2">
            <select className="input" value={tz} onChange={(e) => setTz(e.target.value)}>
              {!TIMEZONES.includes(tz) && <option value={tz}>{tz}</option>}
              {TIMEZONES.map((z) => <option key={z} value={z}>{z}</option>)}
            </select>
          </Field>
        </div>
        {tz !== user.timezone && (
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={moveAlarms} onChange={(e) => setMoveAlarms(e.target.checked)} className="h-4 w-4 accent-brand-500" />
            Keep alarm wall-clock times in the new timezone (recommended when travelling)
          </label>
        )}
        <button className="btn-primary mt-4" onClick={saveProfile} disabled={busy === 'profile'}>{busy === 'profile' && <Spinner size={16} />} Save profile</button>
      </Section>

      <Section title="Appearance">
        <Segmented value={theme} onChange={setTheme} options={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} />
      </Section>

      <Section title="Your day">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Wake up"><input type="time" className="input" value={prefs.wake_time} onChange={setP('wake_time')} /></Field>
          <Field label="Sleep"><input type="time" className="input" value={prefs.sleep_time} onChange={setP('sleep_time')} /></Field>
          <Field label="Work starts"><input type="time" className="input" value={prefs.work_start} onChange={setP('work_start')} /></Field>
          <Field label="Work ends"><input type="time" className="input" value={prefs.work_end} onChange={setP('work_end')} /></Field>
        </div>
        <Field label="Work days" className="mt-3"><DayPicker value={prefs.work_days} onChange={setP('work_days')} /></Field>
        <div className="mt-4 space-y-3">
          <Field label="Preferred workout time"><Segmented value={prefs.preferred_workout_time} onChange={setP('preferred_workout_time')} options={WINDOWS.filter((w) => w !== 'night').map((w) => ({ value: w, label: w[0].toUpperCase() + w.slice(1) }))} /></Field>
          <Field label="Preferred creative time"><Segmented value={prefs.preferred_creative_time} onChange={setP('preferred_creative_time')} options={WINDOWS.map((w) => ({ value: w, label: w[0].toUpperCase() + w.slice(1) }))} /></Field>
          <Field label="Preferred freelance time"><Segmented value={prefs.preferred_freelance_time} onChange={setP('preferred_freelance_time')} options={WINDOWS.map((w) => ({ value: w, label: w[0].toUpperCase() + w.slice(1) }))} /></Field>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Break between tasks (min)"><input type="number" min="0" className="input" value={prefs.min_break_minutes} onChange={setP('min_break_minutes')} /></Field>
          <Field label="Max focus block (min)"><input type="number" min="15" className="input" value={prefs.max_focus_minutes} onChange={setP('max_focus_minutes')} /></Field>
          <Field label="Default reminder (min)"><input type="number" min="0" className="input" value={prefs.default_reminder_minutes} onChange={setP('default_reminder_minutes')} /></Field>
          <Field label="Default snooze (min)"><input type="number" min="1" className="input" value={prefs.default_snooze_minutes} onChange={setP('default_snooze_minutes')} /></Field>
          <Field label="Default alarm sound">
            <select className="input" value={prefs.default_alarm_sound} onChange={setP('default_alarm_sound')}>
              {SOUNDS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Notify target">
            <select className="input" value={prefs.notify_target} onChange={setP('notify_target')}>
              <option value="all">All devices</option>
              <option value="phone">Phone only</option>
              <option value="laptop">Laptop / browser only</option>
            </select>
          </Field>
        </div>
        <div className="mt-3 flex items-center justify-between">
          <span className="text-sm font-semibold">Vibrate by default</span>
          <Toggle checked={!!prefs.default_vibration} onChange={setP('default_vibration')} label="Vibrate" />
        </div>
        <button className="btn-primary mt-4" onClick={() => savePrefs()} disabled={busy === 'prefs'}>{busy === 'prefs' && <Spinner size={16} />} Save preferences</button>
      </Section>

      <Section id="notifications" title="Notifications">
        {pushState === 'denied' && <p className="mb-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">{DENIED_HELP}</p>}
        {!isNative && pushSupported() && (
          <div className="mb-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
            <div className="flex items-center gap-2 text-sm font-semibold">
              {subscribed ? <Bell size={16} className="text-brand-500" /> : <BellOff size={16} />}
              Browser push on this device
            </div>
            <Toggle checked={subscribed} onChange={togglePush} label="Browser push" />
          </div>
        )}
        {notifPrefs && (
          <div className="space-y-3">
            {NOTIF_TOGGLES.map(([k, label]) => (
              <div key={k} className="flex items-center justify-between text-sm">
                <span className="font-medium">{label}</span>
                <Toggle checked={!!notifPrefs[k]} onChange={(v) => saveNotif({ [k]: v })} label={label} />
              </div>
            ))}
            <div className="grid grid-cols-2 gap-3 pt-2">
              <Field label="Daily briefing time"><input type="time" className="input" value={notifPrefs.daily_briefing_time || ''} onChange={(e) => saveNotif({ daily_briefing_time: e.target.value })} /></Field>
              <Field label="Weekly planning">
                <div className="flex gap-2">
                  <select className="input" value={notifPrefs.weekly_planning_day || 'SUN'} onChange={(e) => saveNotif({ weekly_planning_day: e.target.value })}>
                    {DAYS.map((d) => <option key={d} value={d}>{d[0] + d.slice(1, 3).toLowerCase()}</option>)}
                  </select>
                  <input type="time" className="input" value={notifPrefs.weekly_planning_time || ''} onChange={(e) => saveNotif({ weekly_planning_time: e.target.value })} />
                </div>
              </Field>
              <Field label="Quiet hours start"><input type="time" className="input" value={notifPrefs.quiet_hours_start || ''} onChange={(e) => saveNotif({ quiet_hours_start: e.target.value || null })} /></Field>
              <Field label="Quiet hours end"><input type="time" className="input" value={notifPrefs.quiet_hours_end || ''} onChange={(e) => saveNotif({ quiet_hours_end: e.target.value || null })} /></Field>
            </div>
          </div>
        )}
      </Section>

      <Section title="Categories">
        <ul className="space-y-2">
          {categories.map((c) => (
            <li key={c.id} className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl text-lg" style={{ background: `${c.color}22` }}>{c.icon}</span>
              <span className="flex-1 font-semibold">{c.name}</span>
              <button className="btn-ghost p-2" onClick={() => setCatForm(c)} aria-label={`Edit ${c.name}`}><Pencil size={14} /></button>
              {!c.is_default && <button className="btn-ghost p-2 text-rose-500" onClick={async () => { if (confirm(`Delete category ${c.name}?`)) { await api.del(`/categories/${c.id}`); emit('categories'); } }} aria-label={`Delete ${c.name}`}><Trash2 size={14} /></button>}
            </li>
          ))}
        </ul>
        <button className="btn-secondary mt-3" onClick={() => setCatForm({ name: '', icon: '📌', color: '#6366f1' })}><Plus size={16} /> Add category</button>
      </Section>

      <Section title="Fixed schedule blocks">
        <p className="mb-3 text-sm text-slate-500">Work hours and meals are treated as busy time so tasks don’t land on top of them.</p>
        <ul className="space-y-2">
          {(blocks || []).map((b) => (
            <li key={b.id} className="flex items-center gap-3 rounded-xl bg-slate-50 px-3 py-2 dark:bg-white/5">
              <span>{b.icon}</span>
              <button className="flex-1 text-left" onClick={() => setBlockForm(b)}>
                <span className="block font-semibold">{b.title}</span>
                <span className="text-xs text-slate-400">{b.start_time}–{b.end_time} · {b.days.join(', ')}</span>
              </button>
              <button className="btn-ghost p-2 text-rose-500" onClick={async () => { await api.del(`/schedule-blocks/${b.id}`); reloadBlocks(); }} aria-label={`Delete ${b.title}`}><Trash2 size={14} /></button>
            </li>
          ))}
        </ul>
        <button className="btn-secondary mt-3" onClick={() => setBlockForm({ title: '', block_type: 'other', days: DAYS.slice(0, 5), start_time: '12:00', end_time: '13:00', icon: '📌' })}><Plus size={16} /> Add block</button>
      </Section>

      <Section title="Password">
        <form onSubmit={changePw} className="space-y-3">
          <Field label="Current password"><PasswordInput value={pw.current} onChange={(e) => setPw((p) => ({ ...p, current: e.target.value }))} autoComplete="current-password" /></Field>
          <Field label="New password"><PasswordInput value={pw.next} onChange={(e) => setPw((p) => ({ ...p, next: e.target.value }))} autoComplete="new-password" /></Field>
          <Field label="Confirm new password"><PasswordInput value={pw.confirm} onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))} autoComplete="new-password" /></Field>
          <button className="btn-primary" disabled={busy === 'pw'}>{busy === 'pw' && <Spinner size={16} />} Change password</button>
        </form>
      </Section>

      <button className="btn-danger w-full" onClick={logout}><LogOut size={16} /> Sign out</button>

      {catForm && <CategoryModal cat={catForm} onClose={() => setCatForm(null)} />}
      {blockForm && <BlockModal block={blockForm} onClose={() => { setBlockForm(null); reloadBlocks(); }} />}
    </div>
  );
}

function CategoryModal({ cat, onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ name: cat.name, icon: cat.icon, color: cat.color });
  const save = async () => {
    try {
      if (cat.id) await api.put(`/categories/${cat.id}`, f);
      else await api.post('/categories', f);
      emit('categories');
      onClose();
    } catch (err) {
      toast.error(err.message);
    }
  };
  return (
    <Modal open onClose={onClose} title={cat.id ? 'Edit category' : 'New category'} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
      <div className="space-y-3">
        <Field label="Name"><input className="input" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value }))} /></Field>
        <Field label="Icon"><input className="input" value={f.icon} onChange={(e) => setF((x) => ({ ...x, icon: e.target.value }))} /></Field>
        <Field label="Color"><input type="color" className="h-11 w-full cursor-pointer rounded-xl" value={f.color} onChange={(e) => setF((x) => ({ ...x, color: e.target.value }))} /></Field>
      </div>
    </Modal>
  );
}

function BlockModal({ block, onClose }) {
  const toast = useToast();
  const [f, setF] = useState({ title: block.title, block_type: block.block_type || 'other', days: block.days, start_time: block.start_time, end_time: block.end_time, icon: block.icon || '📌' });
  const save = async () => {
    try {
      if (block.id) await api.put(`/schedule-blocks/${block.id}`, f);
      else await api.post('/schedule-blocks', f);
      onClose();
    } catch (err) {
      toast.error(err.message);
    }
  };
  return (
    <Modal open onClose={onClose} title={block.id ? 'Edit block' : 'New block'} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
      <div className="space-y-3">
        <Field label="Title"><input className="input" value={f.title} onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} /></Field>
        <Field label="Type">
          <select className="input" value={f.block_type} onChange={(e) => setF((x) => ({ ...x, block_type: e.target.value }))}>
            {['work', 'meal', 'sleep', 'routine', 'focus', 'other'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Days"><DayPicker value={f.days} onChange={(d) => setF((x) => ({ ...x, days: d }))} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start"><input type="time" className="input" value={f.start_time} onChange={(e) => setF((x) => ({ ...x, start_time: e.target.value }))} /></Field>
          <Field label="End"><input type="time" className="input" value={f.end_time} onChange={(e) => setF((x) => ({ ...x, end_time: e.target.value }))} /></Field>
        </div>
        <Field label="Icon"><input className="input" value={f.icon} onChange={(e) => setF((x) => ({ ...x, icon: e.target.value }))} /></Field>
      </div>
    </Modal>
  );
}
