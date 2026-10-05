import { useEffect, useState } from 'react';
import { Sparkles, AlertTriangle, AlarmClock, Trash2 } from 'lucide-react';
import { Modal, Field, Toggle, DayPicker, Spinner } from '../../components/ui';
import { api } from '../../services/api';
import { emit } from '../../services/bus';
import { useCategories } from '../../hooks/useCategories';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { dt, todayISO, toUtcIso, fmtDay, fmtRange } from '../../utils/format';

const blank = (prefs) => ({
  title: '',
  description: '',
  category_id: '',
  date: todayISO(),
  time: '',
  duration_minutes: 30,
  priority: 'medium',
  due_date: '',
  reminder_minutes: prefs?.default_reminder_minutes ?? 10,
  alarm_enabled: false,
  repeat_type: 'none',
  repeat_days: [],
});

function fromTask(t) {
  const s = t.start_at ? dt(t.start_at) : null;
  return {
    title: t.title,
    description: t.description || '',
    category_id: t.category_id || '',
    date: s ? s.toISODate() : todayISO(),
    time: s ? s.toFormat('HH:mm') : '',
    duration_minutes: t.duration_minutes,
    priority: t.priority,
    due_date: t.due_at ? dt(t.due_at).toFormat("yyyy-MM-dd'T'HH:mm") : '',
    reminder_minutes: t.reminder_minutes ?? '',
    alarm_enabled: t.alarm_enabled,
    repeat_type: 'none',
    repeat_days: [],
    status: t.status,
    version: t.version,
  };
}

export default function TaskForm({ open, onClose, task, defaults }) {
  const { preferences } = useAuth();
  const categories = useCategories();
  const toast = useToast();
  const [form, setForm] = useState(blank(preferences));
  const [saving, setSaving] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [suggestion, setSuggestion] = useState(null);
  const [suggesting, setSuggesting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(task ? fromTask(task) : { ...blank(preferences), ...defaults });
    setConflict(null);
    setSuggestion(null);
  }, [open, task, defaults, preferences]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e?.target ? e.target.value : e }));

  const payload = (force) => ({
    title: form.title.trim(),
    description: form.description || null,
    category_id: form.category_id ? Number(form.category_id) : null,
    start_at: form.time ? toUtcIso(form.date, form.time) : null,
    duration_minutes: Number(form.duration_minutes) || 30,
    priority: form.priority,
    due_at: form.due_date ? toUtcIso(form.due_date.slice(0, 10), form.due_date.slice(11, 16) || '23:59') : null,
    reminder_minutes: form.reminder_minutes === '' ? null : Number(form.reminder_minutes),
    alarm_enabled: !!form.alarm_enabled && !!form.time,
    force: !!force,
    ...(task ? { version: form.version } : {}),
    ...(!task && form.repeat_type !== 'none' && form.time
      ? { repeat: { repeat_type: form.repeat_type, repeat_days: form.repeat_type === 'selected_days' ? form.repeat_days : undefined } }
      : {}),
  });

  const save = async (force = false) => {
    if (!form.title.trim()) return toast.error('Give the task a title');
    setSaving(true);
    try {
      const res = task ? await api.put(`/tasks/${task.id}`, payload(force)) : await api.post('/tasks', payload(force));
      res.task.warnings?.forEach((w) => toast.info(w));
      toast(task ? 'Task updated' : `Task added${res.task.alarm_id ? ' — alarm syncing to your phone' : ''}`);
      emit('tasks');
      emit('alarms');
      onClose(res.task);
    } catch (err) {
      if (err.status === 409 && err.details?.conflicts) setConflict(err.details);
      else toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const suggest = async () => {
    if (!form.title.trim()) return toast.error('Add a title first so I know what to schedule');
    setSuggesting(true);
    try {
      const cat = categories.find((c) => String(c.id) === String(form.category_id));
      const res = task
        ? await api.post('/assistant/suggest-time', { task_id: task.id })
        : await api.post('/assistant/suggest-time', { title: form.title, category: cat?.slug, duration_minutes: Number(form.duration_minutes) || 30, date: form.time ? undefined : form.date });
      if (!res.action) return toast.info(res.reply);
      // The form saves the task itself, so the stored AI proposal is dismissed.
      api.post(`/assistant/actions/${res.action.id}/reject`).catch(() => {});
      const p = res.action.preview;
      setSuggestion({ reply: res.reply, best: { start_at: p.start_at, end_at: p.end_at }, alternatives: p.alternatives || [] });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSuggesting(false);
    }
  };

  const applySlot = (iso) => {
    const d = dt(iso);
    setForm((f) => ({ ...f, date: d.toISODate(), time: d.toFormat('HH:mm') }));
    setSuggestion(null);
  };

  const remove = async () => {
    if (!confirm(`Delete "${task.title}"?`)) return;
    await api.del(`/tasks/${task.id}`);
    toast('Task deleted');
    emit('tasks');
    emit('alarms');
    onClose(null);
  };

  return (
    <Modal
      open={open}
      onClose={() => onClose()}
      title={task ? 'Edit task' : 'Add task'}
      footer={
        <>
          {task && (
            <button className="btn-danger mr-auto" onClick={remove}>
              <Trash2 size={16} /> Delete
            </button>
          )}
          <button className="btn-secondary" onClick={() => onClose()}>Cancel</button>
          <button className="btn-primary" disabled={saving} onClick={() => save(false)}>
            {saving && <Spinner size={16} />} {task ? 'Save changes' : 'Save task'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Task title">
          <input className="input" autoFocus value={form.title} onChange={set('title')} placeholder="Workout" />
        </Field>
        <Field label="Description">
          <textarea className="input min-h-[64px]" value={form.description} onChange={set('description')} placeholder="Morning workout at gym" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Category">
            <select className="input" value={form.category_id} onChange={set('category_id')}>
              <option value="">None</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>{c.icon} {c.name}</option>
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
          <Field label="Date">
            <input type="date" className="input" value={form.date} onChange={set('date')} />
          </Field>
          <Field label="Time" hint="Leave empty to let AI suggest">
            <input type="time" className="input" value={form.time} onChange={set('time')} />
          </Field>
          <Field label="Duration (minutes)">
            <input type="number" min="5" step="5" className="input" value={form.duration_minutes} onChange={set('duration_minutes')} />
          </Field>
          <Field label="Reminder before (min)">
            <select className="input" value={form.reminder_minutes} onChange={set('reminder_minutes')}>
              <option value="">No reminder</option>
              {[0, 5, 10, 15, 30, 60].map((m) => (
                <option key={m} value={m}>{m === 0 ? 'At start time' : `${m} minutes before`}</option>
              ))}
            </select>
          </Field>
        </div>

        <button type="button" className="btn-secondary w-full" onClick={suggest} disabled={suggesting}>
          {suggesting ? <Spinner size={16} /> : <Sparkles size={16} className="text-brand-500" />} Let AI suggest the best time
        </button>
        {suggestion && (
          <div className="rounded-xl border border-brand-100 bg-brand-50/60 p-3 text-sm dark:border-brand-500/20 dark:bg-brand-500/10">
            <p className="font-semibold">{suggestion.reply}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {suggestion.best.start_at && (
                <button className="btn-primary py-1.5" onClick={() => applySlot(suggestion.best.start_at)}>
                  Use {fmtDay(suggestion.best.start_at)} {fmtRange(suggestion.best.start_at, suggestion.best.end_at)}
                </button>
              )}
              {suggestion.alternatives.map((a) => (
                <button key={a.start_at} className="btn-secondary py-1.5" onClick={() => applySlot(a.start_at)}>
                  {fmtDay(a.start_at)} {fmtRange(a.start_at, a.end_at)}
                </button>
              ))}
            </div>
          </div>
        )}

        <Field label="Deadline (optional)">
          <input type="datetime-local" className="input" value={form.due_date} onChange={set('due_date')} />
        </Field>

        <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3 dark:bg-white/5">
          <div className="flex items-center gap-3">
            <AlarmClock size={18} className="text-brand-500" />
            <div>
              <p className="text-sm font-semibold">Phone alarm</p>
              <p className="text-xs text-slate-400">{form.time ? 'Rings on your Android phone, even offline' : 'Set a time to enable'}</p>
            </div>
          </div>
          <Toggle checked={!!form.alarm_enabled && !!form.time} disabled={!form.time} onChange={set('alarm_enabled')} label="Phone alarm" />
        </div>

        {!task && form.time && (
          <div>
            <Field label="Repeat">
              <select className="input" value={form.repeat_type} onChange={set('repeat_type')}>
                <option value="none">Does not repeat</option>
                <option value="daily">Every day</option>
                <option value="selected_days">Selected days</option>
                <option value="weekly">Weekly</option>
              </select>
            </Field>
            {form.repeat_type === 'selected_days' && (
              <div className="mt-2">
                <DayPicker value={form.repeat_days} onChange={set('repeat_days')} />
              </div>
            )}
          </div>
        )}

        {conflict && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm dark:border-amber-500/30 dark:bg-amber-500/10">
            <p className="flex items-center gap-2 font-semibold text-amber-700 dark:text-amber-300">
              <AlertTriangle size={16} /> Overlaps with {conflict.conflicts.map((c) => `"${c.title}"`).join(', ')}
            </p>
            {conflict.warnings?.map((w) => <p key={w} className="mt-1 text-xs text-amber-600">{w}</p>)}
            <div className="mt-2 flex gap-2">
              <button className="btn-secondary py-1.5" onClick={suggest}>Find a free slot</button>
              <button className="btn-ghost py-1.5" onClick={() => save(true)}>Save anyway</button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}