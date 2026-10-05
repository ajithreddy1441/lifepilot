import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, ListTodo } from 'lucide-react';
import { api } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useCategories } from '../hooks/useCategories';
import { useAssistantRun } from '../features/assistant/AssistantResult';
import { PageHeader, PageLoader, Empty } from '../components/ui';
import TaskForm from '../features/tasks/TaskForm';
import TaskRow from '../features/tasks/TaskRow';
import { dt, now, fmtDay } from '../utils/format';

const FILTERS = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'today', label: 'Today' },
  { id: 'unscheduled', label: 'Unscheduled' },
  { id: 'missed', label: 'Missed' },
  { id: 'completed', label: 'Completed' },
  { id: 'all', label: 'All' },
];

function queryFor(filter) {
  const n = now();
  switch (filter) {
    case 'today': return { from: n.startOf('day').toUTC().toISO(), to: n.endOf('day').toUTC().toISO() };
    case 'upcoming': return { status: 'pending,in_progress', from: n.startOf('day').toUTC().toISO() };
    case 'unscheduled': return { unscheduled: true, status: 'pending,missed' };
    case 'missed': return { status: 'missed' };
    case 'completed': return { status: 'completed' };
    default: return {};
  }
}

export default function Tasks() {
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState('upcoming');
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [form, setForm] = useState(null);
  const categories = useCategories();
  const runAssistant = useAssistantRun();
  const { data: tasks, loading } = useApi(
    () => api.get('/tasks', { ...queryFor(filter), q: q || undefined, category_id: category || undefined }).then((r) => r.tasks),
    [filter, q, category],
    { topics: ['tasks'] },
  );

  const reschedule = (t) => runAssistant(`Reschedule ${t.title}`, () => api.post('/assistant/reschedule', { task_id: t.id }));

  // Deep links from notifications and the dashboard: ?open=ID, ?new=1, ?reschedule=ID
  useEffect(() => {
    const open = params.get('open');
    const res = params.get('reschedule');
    if (params.get('new')) setForm({});
    if (open || res) {
      api.get(`/tasks/${open || res}`).then(({ task }) => (res ? reschedule(task) : setForm({ task }))).catch(() => {});
    }
    if (open || res || params.get('new')) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const groups = useMemo(() => {
    const g = new Map();
    (tasks || []).forEach((t) => {
      const key = t.start_at ? dt(t.start_at).toISODate() : 'unscheduled';
      if (!g.has(key)) g.set(key, { label: t.start_at ? `${fmtDay(t.start_at)} · ${dt(t.start_at).toFormat('d LLL')}` : 'Unscheduled', items: [] });
      g.get(key).items.push(t);
    });
    return [...g.values()];
  }, [tasks]);

  return (
    <div>
      <PageHeader title="Tasks" subtitle="Everything on your plate" actions={<button className="btn-primary" onClick={() => setForm({})}><Plus size={16} /> Add task</button>} />
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex gap-1.5 overflow-x-auto scrollbar-none">
          {FILTERS.map((f) => (
            <button key={f.id} onClick={() => setFilter(f.id)} className={`chip shrink-0 px-3 py-1.5 text-sm ${filter === f.id ? 'bg-brand-500 text-white' : 'bg-white text-slate-600 dark:bg-ink-850 dark:text-slate-300'}`}>{f.label}</button>
          ))}
        </div>
        <div className="flex flex-1 gap-2 md:justify-end">
          <div className="relative flex-1 md:max-w-xs">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search tasks" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input w-auto" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">All categories</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.icon} {c.name}</option>)}
          </select>
        </div>
      </div>

      {loading && !tasks ? (
        <PageLoader />
      ) : groups.length ? (
        <div className="space-y-4">
          {groups.map((g) => (
            <div key={g.label}>
              <p className="mb-1.5 px-1 text-xs font-bold uppercase tracking-wide text-slate-400">{g.label}</p>
              <div className="card p-1.5">
                {g.items.map((t) => <TaskRow key={t.id} task={t} onOpen={(x) => setForm({ task: x })} onReschedule={reschedule} />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty icon={ListTodo} title="No tasks here" text="Add one, or just say “Add a task to finish the website by Friday”." action={<button className="btn-primary" onClick={() => setForm({})}><Plus size={16} /> Add task</button>} />
        </div>
      )}
      <TaskForm open={!!form} task={form?.task} defaults={form?.defaults} onClose={() => setForm(null)} />
    </div>
  );
}
