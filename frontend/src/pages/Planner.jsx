import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Sparkles, Plus } from 'lucide-react';
import { api } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useAssistantRun } from '../features/assistant/AssistantResult';
import { PageHeader, PageLoader, Segmented } from '../components/ui';
import TaskForm from '../features/tasks/TaskForm';
import { dt, now, todayISO, fmtTime } from '../utils/format';

function WeekView({ start, onOpenTask, onAdd }) {
  const navigate = useNavigate();
  const { data, loading } = useApi(() => api.get('/planner/week', { start }), [start], { topics: ['tasks', 'planner'] });
  if (loading && !data) return <PageLoader />;
  const today = todayISO();
  return (
    <div className="grid gap-3 md:grid-cols-7">
      {data.days.map((d) => {
        const tasks = d.timeline.filter((i) => i.kind === 'task');
        const blocks = d.timeline.filter((i) => i.kind === 'block');
        const busyMin = tasks.reduce((s, t) => s + t.task.duration_minutes, 0);
        const day = dt(`${d.date}T12:00:00`);
        return (
          <div key={d.date} className={`card flex min-h-[180px] flex-col p-3 ${d.date === today ? 'ring-2 ring-brand-400' : ''}`}>
            <button onClick={() => navigate(`/today?date=${d.date}`)} className="mb-2 flex items-baseline justify-between text-left">
              <span>
                <span className="block text-xs font-bold uppercase text-slate-400">{day.toFormat('ccc')}</span>
                <span className="text-xl font-extrabold">{day.day}</span>
              </span>
              <span className={`text-[11px] font-semibold ${busyMin > 360 ? 'text-rose-500' : 'text-slate-400'}`}>{Math.round(busyMin / 6) / 10}h</span>
            </button>
            {blocks.filter((b) => b.block_type === 'work').map((b, i) => (
              <p key={i} className="mb-1 rounded-md bg-sky-50 px-2 py-1 text-[11px] font-semibold text-sky-700 dark:bg-sky-500/10 dark:text-sky-300">{b.icon} {fmtTime(b.start_at)}–{fmtTime(b.end_at)}</p>
            ))}
            <div className="flex-1 space-y-1">
              {tasks.map((t) => (
                <button key={t.task.id} onClick={() => onOpenTask(t.task)} className={`block w-full truncate rounded-md px-2 py-1 text-left text-xs font-semibold ${t.task.status === 'completed' ? 'bg-emerald-50 text-emerald-700 line-through dark:bg-emerald-500/10 dark:text-emerald-300' : 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-200'}`}>
                  {fmtTime(t.start_at)} {t.task.category_icon} {t.title}
                </button>
              ))}
            </div>
            <button onClick={() => onAdd(d.date)} className="mt-2 flex items-center justify-center gap-1 rounded-md py-1 text-xs text-slate-400 hover:bg-slate-50 hover:text-brand-500 dark:hover:bg-white/5">
              <Plus size={13} /> Add
            </button>
          </div>
        );
      })}
    </div>
  );
}

function MonthView({ month, onAdd }) {
  const navigate = useNavigate();
  const first = dt(`${month}-01T12:00:00`).startOf('month');
  const gridStart = first.startOf('week');
  const gridEnd = first.endOf('month').endOf('week');
  const { data: tasks, loading } = useApi(
    () => api.get('/tasks', { from: gridStart.toUTC().toISO(), to: gridEnd.toUTC().toISO() }).then((r) => r.tasks),
    [month],
    { topics: ['tasks'], initial: null },
  );
  const byDay = useMemo(() => {
    const m = {};
    (tasks || []).filter((t) => t.start_at).forEach((t) => {
      const k = dt(t.start_at).toISODate();
      (m[k] ||= []).push(t);
    });
    return m;
  }, [tasks]);
  if (loading && !tasks) return <PageLoader />;
  const days = [];
  for (let d = gridStart; d <= gridEnd; d = d.plus({ days: 1 })) days.push(d);
  const today = todayISO();
  return (
    <div className="card overflow-hidden">
      <div className="grid grid-cols-7 border-b border-slate-100 text-center text-xs font-bold uppercase text-slate-400 dark:border-white/5">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="py-2">{d}</div>)}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const key = d.toISODate();
          const items = byDay[key] || [];
          const inMonth = d.month === first.month;
          return (
            <div key={key} onDoubleClick={() => onAdd(key)} className={`min-h-[72px] border-b border-r border-slate-100 p-1.5 md:min-h-[104px] dark:border-white/5 ${inMonth ? '' : 'opacity-40'}`}>
              <button onClick={() => navigate(`/today?date=${key}`)} className={`mb-1 flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold ${key === today ? 'bg-brand-500 text-white' : ''}`}>{d.day}</button>
              <div className="hidden space-y-0.5 md:block">
                {items.slice(0, 3).map((t) => (
                  <p key={t.id} className={`truncate rounded px-1 text-[11px] font-medium ${t.status === 'completed' ? 'text-slate-400 line-through' : 'bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-200'}`}>{t.category_icon} {t.title}</p>
                ))}
                {items.length > 3 && <p className="px-1 text-[11px] text-slate-400">+{items.length - 3} more</p>}
              </div>
              {items.length > 0 && <div className="flex gap-0.5 md:hidden">{items.slice(0, 4).map((t) => <span key={t.id} className="h-1.5 w-1.5 rounded-full bg-brand-500" />)}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Planner() {
  const [view, setView] = useState('week');
  const [anchor, setAnchor] = useState(now());
  const [form, setForm] = useState(null);
  const runAssistant = useAssistantRun();

  const weekStart = anchor.startOf('week').toISODate();
  const month = anchor.toFormat('yyyy-MM');
  const step = (n) => setAnchor((a) => a.plus(view === 'week' ? { weeks: n } : { months: n }));
  const label = view === 'week' ? `${anchor.startOf('week').toFormat('d LLL')} – ${anchor.endOf('week').toFormat('d LLL yyyy')}` : anchor.toFormat('LLLL yyyy');
  const isThisWeek = weekStart === now().startOf('week').toISODate();

  return (
    <div>
      <PageHeader
        title="Planner"
        subtitle={label}
        actions={
          <>
            <Segmented value={view} onChange={setView} options={[{ value: 'week', label: 'Week' }, { value: 'month', label: 'Month' }]} />
            <div className="flex items-center rounded-xl bg-white shadow-sm dark:bg-ink-850">
              <button className="p-2.5" onClick={() => step(-1)} aria-label="Previous"><ChevronLeft size={18} /></button>
              <button className="px-2 text-sm font-semibold" onClick={() => setAnchor(now())}>Now</button>
              <button className="p-2.5" onClick={() => step(1)} aria-label="Next"><ChevronRight size={18} /></button>
            </div>
            {view === 'week' && (
              <button
                className="btn-primary"
                onClick={() => runAssistant('Plan my week', () => api.post('/assistant/plan-week', { week: isThisWeek ? 'this' : 'next' }))}
              >
                <Sparkles size={16} /> Plan {isThisWeek ? 'this' : 'next'} week
              </button>
            )}
          </>
        }
      />
      {view === 'week' ? (
        <WeekView start={weekStart} onOpenTask={(t) => setForm({ task: t })} onAdd={(date) => setForm({ defaults: { date } })} />
      ) : (
        <MonthView month={month} onAdd={(date) => setForm({ defaults: { date } })} />
      )}
      <TaskForm open={!!form} task={form?.task} defaults={form?.defaults} onClose={() => setForm(null)} />
    </div>
  );
}
