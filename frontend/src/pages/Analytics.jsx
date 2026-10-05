import { useState } from 'react';
import { api } from '../services/api';
import { useApi } from '../hooks/useApi';
import { PageHeader, PageLoader, Segmented, ProgressRing } from '../components/ui';
import { dt, minutesLabel } from '../utils/format';

export default function Analytics() {
  const [range, setRange] = useState('week');
  const { data, loading } = useApi(() => api.get('/analytics', { range }), [range], { topics: ['tasks', 'habits'] });

  const max = Math.max(1, ...(data?.per_day || []).map((d) => d.total));
  const catTotal = (data?.categories || []).reduce((s, c) => s + c.minutes, 0) || 1;

  return (
    <div>
      <PageHeader
        title="Analytics"
        subtitle="How your time is really spent"
        actions={<Segmented value={range} onChange={setRange} options={[{ value: 'week', label: '7 days' }, { value: 'month', label: '30 days' }, { value: 'year', label: 'Year' }]} />}
      />
      {loading && !data ? (
        <PageLoader />
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="card flex items-center gap-3 p-4">
              <ProgressRing value={data.completion_rate} size={64} stroke={7} />
              <p className="text-xs font-semibold text-slate-400">Completion rate</p>
            </div>
            <div className="card p-4"><p className="text-xs font-semibold text-slate-400">Completed</p><p className="mt-1 text-2xl font-extrabold">{data.completed} <span className="text-sm text-slate-400">/ {data.total}</span></p></div>
            <div className="card p-4"><p className="text-xs font-semibold text-slate-400">Focus time</p><p className="mt-1 text-2xl font-extrabold">{minutesLabel(data.focus_minutes)}</p></div>
            <div className="card p-4"><p className="text-xs font-semibold text-slate-400">Missed</p><p className="mt-1 text-2xl font-extrabold text-rose-500">{data.missed}</p></div>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            <div className="card p-5 lg:col-span-2">
              <p className="font-extrabold">Tasks per day</p>
              <p className="text-xs text-slate-400">{range === 'year' ? 'Last 31 days' : ''}</p>
              <div className="mt-4 flex h-48 items-end gap-1">
                {data.per_day.map((d) => (
                  <div key={d.date} className="group relative flex flex-1 flex-col items-center justify-end" title={`${d.date}: ${d.completed}/${d.total}`}>
                    <div className="relative w-full overflow-hidden rounded-t-md bg-slate-100 dark:bg-ink-700" style={{ height: `${(d.total / max) * 100}%`, minHeight: d.total ? 4 : 2 }}>
                      <div className="absolute bottom-0 w-full bg-gradient-to-t from-brand-500 to-fuchsia-400" style={{ height: d.total ? `${(d.completed / d.total) * 100}%` : 0 }} />
                    </div>
                    {data.per_day.length <= 7 && <span className="mt-1 text-[10px] text-slate-400">{dt(`${d.date}T12:00:00`).toFormat('ccc')}</span>}
                  </div>
                ))}
              </div>
              <p className="mt-3 text-sm text-slate-500">Most productive time: <b>{data.most_productive || 'not enough data yet'}</b></p>
            </div>
            <div className="card p-5">
              <p className="mb-3 font-extrabold">Time by category</p>
              {data.categories.length ? data.categories.map((c) => (
                <div key={c.name} className="mb-2.5">
                  <div className="flex justify-between text-sm"><span className="font-semibold">{c.name}</span><span className="text-slate-500">{minutesLabel(c.minutes)}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-slate-100 dark:bg-ink-700"><div className="h-full rounded-full" style={{ width: `${(c.minutes / catTotal) * 100}%`, background: c.color }} /></div>
                </div>
              )) : <p className="text-sm text-slate-400">Complete some tasks to see this.</p>}
              {!!data.habits.length && (
                <>
                  <p className="mb-2 mt-5 font-extrabold">Habits</p>
                  {data.habits.map((h) => <p key={h.title} className="flex justify-between text-sm"><span>{h.title}</span><b>{h.done}×</b></p>)}
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
