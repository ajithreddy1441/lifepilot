import { useEffect, useState } from 'react';
import { Trash2, Volume2, Vibrate } from 'lucide-react';
import { Modal, Field, Toggle, DayPicker, Spinner } from '../../components/ui';
import { api } from '../../services/api';
import { emit } from '../../services/bus';
import { useCategories } from '../../hooks/useCategories';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { todayISO, now } from '../../utils/format';

export const SOUNDS = [
  { value: 'default', label: 'Default alarm' },
  { value: 'gentle', label: 'Gentle rise' },
  { value: 'classic', label: 'Classic bell' },
  { value: 'digital', label: 'Digital beep' },
  { value: 'silent', label: 'Silent (notification only)' },
];

const blank = (prefs) => ({
  title: '',
  description: '',
  alarm_date: todayISO(),
  alarm_time: now().plus({ hours: 1 }).startOf('hour').toFormat('HH:mm'),
  duration_minutes: '',
  repeat_type: 'once',
  repeat_days: [],
  repeat_interval_days: 2,
  reminder_minutes: prefs?.default_reminder_minutes ?? 10,
  snooze_minutes: prefs?.default_snooze_minutes ?? 10,
  sound: prefs?.default_alarm_sound || 'default',
  vibration: prefs?.default_vibration ?? true,
  priority: 'medium',
  category_id: '',
  notify_target: prefs?.notify_target || 'all',
  enabled: true,
});

export default function AlarmForm({ open, onClose, alarm }) {
  const { preferences } = useAuth();
  const categories = useCategories();
  const toast = useToast();
  const [form, setForm] = useState(blank(preferences));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(alarm ? { ...blank(preferences), ...alarm, duration_minutes: alarm.duration_minutes ?? '', reminder_minutes: alarm.reminder_minutes ?? 0, category_id: alarm.category_id || '', repeat_interval_days: alarm.repeat_interval_days || 2 } : blank(preferences));
  }, [open, alarm, preferences]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const save = async () => {
    if (!form.title.trim()) return toast.error('Give the alarm a title');
    if (form.repeat_type === 'selected_days' && !form.repeat_days.length) return toast.error('Pick at least one day');
    setSaving(true);
    const body = {
      title: form.title.trim(),
      description: form.description || null,
      alarm_date: form.alarm_date,
      alarm_time: form.alarm_time,
      duration_minutes: form.duration_minutes ? Number(form.duration_minutes) : null,
      repeat_type: form.repeat_type,
      repeat_days: ['selected_days', 'weekly'].includes(form.repeat_type) && form.repeat_days.length ? form.repeat_days : null,
      repeat_interval_days: form.repeat_type === 'custom' ? Number(form.repeat_interval_days) : null,
      reminder_minutes: Number(form.reminder_minutes) || 0,
      snooze_minutes: Number(form.snooze_minutes) || 10,
      sound: form.sound,
      vibration: !!form.vibration,
      priority: form.priority,
      category_id: form.category_id ? Number(form.category_id) : null,
      notify_target: form.notify_target,
      enabled: !!form.enabled,
      ...(alarm ? { version: alarm.version } : {}),
    };
    try {
      const res = alarm ? await api.put(`/alarms/${alarm.id}`, body) : await api.post('/alarms', body);
      toast(alarm ? 'Alarm updated — phone will re-sync' : 'Alarm created — syncing to your phone');
      emit('alarms');
      onClose(res.alarm);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!confirm(`Delete the "${alarm.title}" alarm from all devices?`)) return;
    await api.del(`/alarms/${alarm.id}`);
    toast('Alarm deleted on all devices');
    emit('alarms');
    onClose(null);
  };

  return (
    <Modal
      open={open}
      onClose={() => onClose()}
      title={alarm ? 'Alarm details' : 'New alarm'}
      footer={
        <>
          {alarm && (
            <button className="btn-danger mr-auto" onClick={remove}>
              <Trash2 size={16} /> Delete
            </button>
          )}
          <button className="btn-secondary" onClick={() => onClose()}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={save}>
            {saving && <Spinner size={16} />} {alarm ? 'Save changes' : 'Create alarm'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="text-center">
          <input type="time" value={form.alarm_time} onChange={set('alarm_time')} className="w-full bg-transparent text-center text-5xl font-extrabold tracking-tight outline-none" aria-label="Alarm time" />
        </div>
        <Field label="Title">
          <input className="input" value={form.title} onChange={set('title')} placeholder="Workout" autoFocus={!alarm} />
        </Field>
        <Field label="Description">
          <input className="input" value={form.description || ''} onChange={set('description')} placeholder="It's time for your workout!" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={form.repeat_type === 'once' ? 'Date' : 'Starts on'}>
            <input type="date" className="input" value={form.alarm_date} onChange={set('alarm_date')} />
          </Field>
          <Field label="Duration (min)">
            <input type="number" min="1" className="input" value={form.duration_minutes} onChange={set('duration_minutes')} placeholder="40" />
          </Field>
        </div>
        <Field label="Repeat">
          <select className="input" value={form.repeat_type} onChange={set('repeat_type')}>
            <option value="once">Once</option>
            <option value="daily">Every day</option>
            <option value="selected_days">Selected days</option>
            <option value="weekly">Weekly</option>
            <option value="custom">Every N days</option>
          </select>
        </Field>
        {(form.repeat_type === 'selected_days' || form.repeat_type === 'weekly') && <DayPicker value={form.repeat_days} onChange={set('repeat_days')} />}
        {form.repeat_type === 'custom' && (
          <Field label="Repeat every (days)">
            <input type="number" min="1" className="input" value={form.repeat_interval_days} onChange={set('repeat_interval_days')} />
          </Field>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Reminder">
            <select className="input" value={form.reminder_minutes} onChange={set('reminder_minutes')}>
              {[0, 5, 10, 15, 30, 60].map((m) => (
                <option key={m} value={m}>{m ? `${m} minutes before` : 'No reminder'}</option>
              ))}
            </select>
          </Field>
          <Field label="Snooze">
            <select className="input" value={form.snooze_minutes} onChange={set('snooze_minutes')}>
              {[5, 10, 15, 20, 30].map((m) => (
                <option key={m} value={m}>{m} minutes</option>
              ))}
            </select>
          </Field>
          <Field label="Sound">
            <select className="input" value={form.sound} onChange={set('sound')}>
              {SOUNDS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select className="input" value={form.priority} onChange={set('priority')}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </Field>
          <Field label="Category">
            <select className="input" value={form.category_id} onChange={set('category_id')}>
              <option value="">None</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
              ))}
            </select>
          </Field>
          <Field label="Notify">
            <select className="input" value={form.notify_target} onChange={set('notify_target')}>
              <option value="all">All devices</option>
              <option value="phone">Phone only</option>
              <option value="laptop">Laptop / browser only</option>
            </select>
          </Field>
        </div>
        <div className="space-y-2 rounded-xl bg-slate-50 p-3 dark:bg-white/5">
          <label className="flex items-center justify-between text-sm font-semibold">
            <span className="flex items-center gap-2"><Vibrate size={16} className="text-brand-500" /> Vibration</span>
            <Toggle checked={!!form.vibration} onChange={set('vibration')} label="Vibration" />
          </label>
          <label className="flex items-center justify-between text-sm font-semibold">
            <span className="flex items-center gap-2"><Volume2 size={16} className="text-brand-500" /> Enabled</span>
            <Toggle checked={!!form.enabled} onChange={set('enabled')} label="Enabled" />
          </label>
        </div>
      </div>
    </Modal>
  );
}
