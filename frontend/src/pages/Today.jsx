import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Plus, Sparkles } from 'lucide-react';
import { api } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useAssistantRun } from '../features/assistant/AssistantResult';
import { PageHeader, PageLoader, ProgressRing, Empty } from '../components/ui';
import Timeline from '../features/planner/Timeline';
import TaskForm from '../features/tasks/TaskForm';
import TaskRow from '../features/tasks/TaskRow';
import { dt, todayISO, fmtDay } from '../utils/format';

export default function Today() {
  const [params, setParams] = useSearchParams();
  const date = params.get('date') || todayISO();
  const [form, setForm] = useState(null);
  const runAssistant = useAssistantRun();
  const { data, loading } = useApi(() => api.get(`/planner/day/${date}`), [date], { topics: ['tasks', 'alarms', 'planner'] });

  const shift = (days) => setParams({ date: dt(`${date}T12:00:00`).plus({ days }).toISODate() });
  const tasks = (data?.timeline || []).filter((i) => i.kind === 'task').map((i) => i.task);
  const label = fmtDay(`${date}T12:00:00`);
  const reschedule = (t) => runAssistant(`Reschedule ${t.title}`, () => api.post('/assistant/reschedule', { task_id: t.id }));

  return (
    <div>
      <PageHeader
        title={label === 'Today' ? 'Today' : label}
        subtitle={dt(`${date}T12:00:00`).toFormat('cccc, d LLLL yyyy')}
        actions={
          <>
            <div className="flex items-center rounded-xl bg-white shadow-sm dark:bg-ink-850">
              <button className="p-2.5" onClick={() => shift(-1)} aria-label="Previous day"><ChevronLeft size={18} /></button>
              <button className="px-2 text-sm font-semibold" onClick={() => setParams({})}>Today</button>
              <button className="p-2.5" onClick={() => shift(1)} aria-label="Next day"><ChevronRight size={18} /></button>
            </div>
            <button className="btn-secondary" onClick={() => runAssistant(`Plan ${label}`, () => api.post('/assistant/plan-day', { date }))}>
              <Sparkles size={16} className="text-brand-500" /> Plan this day
            </button>
            <button className="btn-primary" onClick={() => setForm({ defaults: { date } })}><Plus size={16} /> Task</button>
          </>
        }
      />
      {loading && !data ? (
        <PageLoader />
      ) : (
        <div className="grid gap-4 lg:grid-cols-5">
          <div className="card p-5 lg:col-span-3">
            <h3 className="mb-3 font-extrabold">Timeline</h3>
            <Timeline items={data.timeline} alarms={data.alarms} onOpenTask={(t) => setForm({ task: t })} />
          </div>
          <div className="space-y-4 lg:col-span-2">
            <div className="card flex items-center gap-4 p-5">
              <ProgressRing value={data.progress.percent} size={84} stroke={9} />
              <div>
                <p className="font-extrabold">{data.progress.completed} of {data.progress.total} done</p>
                <p className="text-sm text-slate-500">{data.alarms.length} alarm{data.alarms.length === 1 ? '' : 's'} on this day</p>
              </div>
            </div>
            <div className="card p-2">
              {tasks.length ? (
                tasks.map((t) => <TaskRow key={t.id} task={t} onOpen={(x) => setForm({ task: x })} onReschedule={reschedule} />)
              ) : (
                <Empty title="Nothing planned" text="Add a task or let AI plan this day around your work hours and sleep." />
              )}
            </div>
          </div>
        </div>
      )}
      <TaskForm open={!!form} task={form?.task} defaults={form?.defaults} onClose={() => setForm(null)} />
    </div>
  );
}
