import { useState } from 'react';
import { Plus, Repeat, Flame, Check, Trash2, AlarmClock } from 'lucide-react';
import { api } from '../services/api';
import { emit } from '../services/bus';
import { useApi } from '../hooks/useApi';
import { useCategories } from '../hooks/useCategories';
import { useToast } from '../context/ToastContext';
import { PageHeader, PageLoader, Empty, Modal, Field, DayPicker, Toggle, Spinner } from '../components/ui';
import { DAYS, dt } from '../utils/format';

const ICONS = ['🏃', '💪', '🧘', '📚', '✍️', '💧', '🥗', '😴', '🧠', '🎸', '🙏', '✅'];

function HabitForm({ habit, onClose }) {
  const toast = useToast();
  const categories = useCategories();
  const [f, setF] = useState(() => (habit
    ? { title: habit.title, icon: habit.icon, category_id: habit.category_id || '', repeat_days: habit.repeat_days, reminder_time: habit.reminder_time || '', duration_minutes: habit.duration_minutes, reminder_minutes: habit.reminder_minutes, alarm_enabled: habit.alarm_id ? habit.alarm_sound !== 'silent' : false, active: habit.active }
    : { title: '', icon: '✅', category_id: '', repeat_days: DAYS, reminder_time: '', duration_minutes: 30, reminder_minutes: 10, alarm_enabled: false, active: true }));
  const [saving, setSaving] = useState(false);
  const close = onClose;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));

  const save = async () => {
    if (!f.title.trim()) return toast.error('Name your habit');
    if (!f.repeat_days.length) return toast.error('Pick at least one day');
    setSaving(true);
    const body = { ...f, category_id: f.category_id ? Number(f.category_id) : null, reminder_time: f.reminder_time || null, duration_minutes: Number(f.duration_minutes), reminder_minutes: Number(f.reminder_minutes) };
    try {
      if (habit) await api.put(`/habits/${habit.id}`, body);
      else await api.post('/habits', body);
      toast(habit ? 'Habit updated' : 'Habit created');
      emit('habits');
      emit('alarms');
      close();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete habit "${habit.title}" and its history?`)) return;
    await api.del(`/habits/${habit.id}`);
    emit('habits');
    emit('alarms');
    toast('Habit deleted');
    close();
  };

  return (
    <Modal open onClose={close} title={habit ? 'Edit habit' : 'New habit'} footer={
      <>
        {habit && <button className="btn-danger mr-auto" onClick={remove}><Trash2 size={16} /> Delete</button>}
        <button className="btn-secondary" onClick={close}>Cancel</button>
        <button className="btn-primary" onClick={save} disabled={saving}>{saving && <Spinner size={16} />} Save</button>
      </>
    }>
      <div className="space-y-4">
        <Field label="Habit">
          <input className="input" autoFocus value={f.title} onChange={set('title')} placeholder="Morning workout" />
        </Field>
        <div className="flex flex-wrap gap-1.5">
          {ICONS.map((i) => (
            <button key={i} type="button" onClick={() => set('icon')(i)} className={`h-10 w-10 rounded-xl text-xl ${f.icon === i ? 'bg-brand-100 ring-2 ring-brand-400 dark:bg-brand-500/20' : 'bg-slate-100 dark:bg-ink-800'}`}>{i}</button>
          ))}
        </div>
        <Field label="Days"><DayPicker value={f.repeat_days} onChange={set('repeat_days')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Time (optional)" hint="Adds a daily reminder"><input type="time" className="input" value={f.reminder_time} onChange={set('reminder_time')} /></Field>
          <Field label="Duration (min)"><input type="number" min="5" className="input" value={f.duration_minutes} onChange={set('duration_minutes')} /></Field>
          <Field label="Category">
            <select className="input" value={f.category_id} onChange={set('category_id')}>
              <option value="">None</option>
              {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
            </select>
          </Field>
          <Field label="Remind before (min)"><input type="number" min="0" className="input" value={f.reminder_minutes} onChange={set('reminder_minutes')} /></Field>
        </div>
        {f.reminder_time && (
          <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
            <span className="flex items-center gap-2 text-sm font-semibold"><AlarmClock size={16} className="text-brand-500" /> Ring as a phone alarm</span>
            <Toggle checked={f.alarm_enabled} onChange={set('alarm_enabled')} label="Ring as alarm" />
          </div>
        )}
        {habit && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold">Active</span>
            <Toggle checked={f.active} onChange={set('active')} label="Active" />
          </div>
        )}
      </div>
    </Modal>
  );
}

export default function Habits() {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const { data: habits, setData, loading } = useApi(() => api.get('/habits').then((r) => r.habits), [], { topics: ['habits'], initial: [] });

  const log = async (h, date) => {
    setData((list) => list.map((x) => (x.id === h.id && !date ? { ...x, done_today: !x.done_today } : x)));
    try {
      const r = await api.post(`/habits/${h.id}/log`, date ? { date } : {});
      if (r.done && !date) toast(`${h.icon} Nice! ${h.title} logged`);
      emit('habits');
    } catch (err) {
      toast.error(err.message);
      emit('habits');
    }
  };

  return (
    <div>
      <PageHeader title="Habits" subtitle="Small things, every day" actions={<button className="btn-primary" onClick={() => setForm({})}><Plus size={16} /> New habit</button>} />
      {loading && !habits ? (
        <PageLoader />
      ) : habits.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          {habits.map((h) => (
            <div key={h.id} className={`card p-4 ${h.active ? '' : 'opacity-60'}`}>
              <div className="flex items-center gap-3">
                <button onClick={() => setForm({ habit: h })} className="flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-50 text-2xl dark:bg-brand-500/10">{h.icon}</button>
                <button onClick={() => setForm({ habit: h })} className="min-w-0 flex-1 text-left">
                  <p className="truncate font-bold">{h.title}</p>
                  <p className="text-xs text-slate-500">
                    {h.repeat_days.length === 7 ? 'Every day' : h.repeat_days.map((d) => d[0] + d.slice(1, 3).toLowerCase()).join(', ')}
                    {h.reminder_time && ` · ${h.reminder_time}`}
                    {h.alarm_id && (h.alarm_sound === 'silent' ? ' · 🔔' : ' · ⏰')}
                  </p>
                </button>
                <span className="flex items-center gap-1 text-sm font-bold text-orange-500"><Flame size={16} /> {h.streak}</span>
                <button
                  onClick={() => log(h)}
                  className={`flex h-11 w-11 items-center justify-center rounded-full border-2 transition ${h.done_today ? 'border-transparent bg-gradient-to-br from-emerald-400 to-teal-500 text-white' : 'border-slate-300 text-slate-300 hover:border-brand-400 dark:border-slate-600'}`}
                  aria-label={h.done_today ? 'Undo today' : 'Mark done today'}
                >
                  <Check size={20} strokeWidth={3} />
                </button>
              </div>
              <div className="mt-3 grid grid-cols-7 gap-1.5">
                {h.week.map((w) => (
                  <button key={w.date} onClick={() => log(h, w.date)} className="flex flex-col items-center gap-1" title={w.date}>
                    <span className="text-[10px] font-semibold text-slate-400">{dt(`${w.date}T12:00:00`).toFormat('ccccc')}</span>
                    <span className={`h-7 w-full rounded-lg ${w.done ? 'bg-gradient-to-br from-brand-500 to-violet-500' : w.scheduled ? 'bg-slate-100 dark:bg-ink-700' : 'bg-slate-50 dark:bg-ink-800/50'}`} />
                  </button>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">{h.week_count} / {h.target_per_week} this week</p>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty icon={Repeat} title="No habits yet" text="Track workouts, reading, water — anything you want to do regularly. Habits with a time get a reminder or phone alarm." action={<button className="btn-primary" onClick={() => setForm({})}><Plus size={16} /> New habit</button>} />
        </div>
      )}
      {form && <HabitForm habit={form.habit} onClose={() => setForm(null)} />}
    </div>
  );
}
