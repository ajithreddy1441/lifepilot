import { useState } from 'react';
import { Plus, Target, Sparkles, Trash2, CheckCircle2, Circle, Minus } from 'lucide-react';
import { api } from '../services/api';
import { emit } from '../services/bus';
import { useApi } from '../hooks/useApi';
import { useCategories } from '../hooks/useCategories';
import { useToast } from '../context/ToastContext';
import { PageHeader, PageLoader, Empty, Modal, Field, Spinner } from '../components/ui';
import { fmtDay } from '../utils/format';

function GoalForm({ goal, onClose }) {
  const toast = useToast();
  const categories = useCategories();
  const [f, setF] = useState(() => ({
    title: goal?.title || '',
    description: goal?.description || '',
    category_id: goal?.category_id || '',
    target_value: goal?.target_value || '',
    current_value: goal?.current_value || 0,
    unit: goal?.unit || '',
    target_date: goal?.target_date || '',
    milestones: '',
  }));
  const [saving, setSaving] = useState(false);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));

  const save = async () => {
    if (!f.title.trim()) return toast.error('Give the goal a title');
    setSaving(true);
    const body = {
      title: f.title,
      description: f.description || null,
      category_id: f.category_id ? Number(f.category_id) : null,
      target_value: f.target_value ? Number(f.target_value) : null,
      current_value: Number(f.current_value) || 0,
      unit: f.unit || null,
      target_date: f.target_date || null,
      milestones: f.milestones.split('\n').map((s) => s.trim()).filter(Boolean).map((title) => ({ title })),
    };
    try {
      if (goal) await api.put(`/goals/${goal.id}`, body);
      else await api.post('/goals', body);
      emit('goals');
      toast(goal ? 'Goal updated' : 'Goal created');
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title={goal ? 'Edit goal' : 'New goal'} footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save} disabled={saving}>{saving && <Spinner size={16} />} Save</button></>}>
      <div className="space-y-4">
        <Field label="Goal"><input className="input" autoFocus value={f.title} onChange={set('title')} placeholder="Write 10 stories" /></Field>
        <Field label="Why / details"><textarea className="input min-h-[60px]" value={f.description} onChange={set('description')} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Target"><input type="number" min="1" className="input" value={f.target_value} onChange={set('target_value')} placeholder="10" /></Field>
          <Field label="Unit"><input className="input" value={f.unit} onChange={set('unit')} placeholder="stories" /></Field>
          <Field label="Current"><input type="number" min="0" className="input" value={f.current_value} onChange={set('current_value')} /></Field>
          <Field label="Target date"><input type="date" className="input" value={f.target_date} onChange={set('target_date')} /></Field>
        </div>
        <Field label="Category">
          <select className="input" value={f.category_id} onChange={set('category_id')}>
            <option value="">None</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </Field>
        <Field label={goal ? 'Add milestones (one per line)' : 'Milestones (one per line)'}><textarea className="input min-h-[70px]" value={f.milestones} onChange={set('milestones')} placeholder={'Outline\nFirst draft\nPublish'} /></Field>
      </div>
    </Modal>
  );
}

function Breakdown({ goal, onClose }) {
  const toast = useToast();
  const { data, loading } = useApi(() => api.post(`/goals/${goal.id}/breakdown`).then((r) => r.tasks.map((t) => ({ ...t, on: true }))), [goal.id]);
  const [items, setItems] = useState(null);
  const [saving, setSaving] = useState(false);
  const list = items || data || [];

  const add = async () => {
    const chosen = list.filter((t) => t.on && t.title.trim());
    if (!chosen.length) return onClose();
    setSaving(true);
    try {
      await api.post(`/goals/${goal.id}/tasks`, { tasks: chosen });
      toast(`${chosen.length} tasks added — use “Plan my week” to schedule them`);
      emit('tasks');
      emit('goals');
      onClose();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  const edit = (i, patch) => setItems(list.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));

  return (
    <Modal open onClose={onClose} title={`Break down: ${goal.title}`} wide footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={add} disabled={saving || loading}>{saving && <Spinner size={16} />} Add selected tasks</button></>}>
      {loading ? (
        <div className="flex items-center gap-2 py-8 text-slate-500"><Spinner /> Breaking your goal into steps…</div>
      ) : (
        <div className="space-y-2">
          <p className="text-sm text-slate-500">Review and edit before adding. Tasks are added unscheduled with due dates — nothing goes on your calendar until you plan it.</p>
          {list.map((t, i) => (
            <div key={i} className="flex items-center gap-2 rounded-xl bg-slate-50 p-2 dark:bg-white/5">
              <input type="checkbox" checked={t.on} onChange={(e) => edit(i, { on: e.target.checked })} className="h-4 w-4 accent-brand-500" />
              <input className="input flex-1 py-1.5" value={t.title} onChange={(e) => edit(i, { title: e.target.value })} />
              <input type="number" className="input w-20 py-1.5" value={t.duration_minutes} onChange={(e) => edit(i, { duration_minutes: Number(e.target.value) })} title="Minutes" />
              <input type="date" className="input w-40 py-1.5" value={t.due_date} onChange={(e) => edit(i, { due_date: e.target.value })} />
            </div>
          ))}
        </div>
      )}
    </Modal>
  );
}

export default function Goals() {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [breakdown, setBreakdown] = useState(null);
  const { data: goals, loading } = useApi(() => api.get('/goals').then((r) => r.goals), [], { topics: ['goals'], initial: [] });

  const bump = async (g, delta) => {
    await api.put(`/goals/${g.id}`, { current_value: Math.max(0, (g.current_value || 0) + delta) });
    emit('goals');
  };
  const toggleMs = async (g, m) => {
    await api.post(`/goals/${g.id}/milestones/${m.id}/toggle`);
    emit('goals');
  };
  const remove = async (g) => {
    if (!confirm(`Delete goal "${g.title}"? Its tasks stay in your list.`)) return;
    await api.del(`/goals/${g.id}`);
    emit('goals');
    toast('Goal deleted');
  };
  const complete = async (g) => {
    await api.put(`/goals/${g.id}`, { status: g.status === 'completed' ? 'active' : 'completed' });
    emit('goals');
    if (g.status !== 'completed') toast(`🎉 Goal achieved: ${g.title}`);
  };

  return (
    <div>
      <PageHeader title="Goals" subtitle="Turn big ambitions into scheduled steps" actions={<button className="btn-primary" onClick={() => setForm({})}><Plus size={16} /> New goal</button>} />
      {loading && !goals ? (
        <PageLoader />
      ) : goals.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {goals.map((g) => (
            <div key={g.id} className={`card p-5 ${g.status === 'completed' ? 'opacity-70' : ''}`}>
              <div className="flex items-start gap-3">
                <span className="text-2xl">{g.category_icon || '🎯'}</span>
                <div className="min-w-0 flex-1">
                  <button onClick={() => setForm({ goal: g })} className="text-left font-extrabold hover:text-brand-600">{g.title}</button>
                  <p className="text-xs text-slate-500">
                    {g.target_date ? `By ${fmtDay(`${g.target_date}T12:00:00`)} · ` : ''}{g.task_done}/{g.task_total} tasks
                    {g.status === 'completed' && ' · ✅ achieved'}
                  </p>
                </div>
                <button onClick={() => remove(g)} className="rounded-lg p-1.5 text-slate-400 hover:text-rose-500" aria-label="Delete goal"><Trash2 size={16} /></button>
              </div>
              <div className="mt-4">
                <div className="flex justify-between text-xs font-semibold"><span>Progress</span><span>{g.progress}%</span></div>
                <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-slate-100 dark:bg-ink-700">
                  <div className="h-full rounded-full bg-gradient-to-r from-sky-400 via-brand-500 to-fuchsia-500 transition-all" style={{ width: `${g.progress}%` }} />
                </div>
              </div>
              {g.target_value && (
                <div className="mt-3 flex items-center gap-2 text-sm">
                  <button className="btn-secondary h-8 w-8 p-0" onClick={() => bump(g, -1)} aria-label="Decrease"><Minus size={14} /></button>
                  <span className="font-bold">{g.current_value} / {g.target_value} {g.unit}</span>
                  <button className="btn-secondary h-8 w-8 p-0" onClick={() => bump(g, 1)} aria-label="Increase"><Plus size={14} /></button>
                </div>
              )}
              {!!g.milestones.length && (
                <ul className="mt-3 space-y-1">
                  {g.milestones.map((m) => (
                    <li key={m.id}>
                      <button onClick={() => toggleMs(g, m)} className="flex items-center gap-2 text-sm">
                        {m.completed_at ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Circle size={16} className="text-slate-300" />}
                        <span className={m.completed_at ? 'text-slate-400 line-through' : ''}>{m.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4 flex flex-wrap gap-2">
                <button className="btn-secondary py-1.5 text-xs" onClick={() => setBreakdown(g)}><Sparkles size={14} className="text-brand-500" /> Break into tasks</button>
                <button className="btn-ghost py-1.5 text-xs" onClick={() => complete(g)}>{g.status === 'completed' ? 'Reopen' : 'Mark achieved'}</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty icon={Target} title="No goals yet" text="Set a goal like “Write 10 stories by December” and let AI break it into tasks." action={<button className="btn-primary" onClick={() => setForm({})}><Plus size={16} /> New goal</button>} />
        </div>
      )}
      {form && <GoalForm goal={form.goal} onClose={() => setForm(null)} />}
      {breakdown && <Breakdown goal={breakdown} onClose={() => setBreakdown(null)} />}
    </div>
  );
}
