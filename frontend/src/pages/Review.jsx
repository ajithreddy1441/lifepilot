import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, CircleDashed, Sparkles, ChevronLeft, ChevronRight, Lightbulb } from 'lucide-react';
import { api } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { useAssistantRun } from '../features/assistant/AssistantResult';
import { PageLoader, Segmented, ProgressRing, Spinner } from '../components/ui';
import { dt, todayISO, fmtRange, fmtDay, now } from '../utils/format';

const MOODS = ['😞', '😕', '😐', '🙂', '😄'];

function Daily() {
  const toast = useToast();
  const runAssistant = useAssistantRun();
  const [date, setDate] = useState(todayISO());
  const { data, loading } = useApi(() => api.get('/reviews/daily', { date }), [date], { topics: ['tasks'] });
  const [mood, setMood] = useState(null);
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (data) {
      setMood(data.mood);
      setNotes(data.notes || '');
    }
  }, [data]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/reviews/daily', { date, mood, notes });
      toast('Reflection saved');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };
  const shift = (n) => setDate(dt(`${date}T12:00:00`).plus({ days: n }).toISODate());

  if (loading && !data) return <PageLoader />;
  if (!data) return <p className="text-sm text-slate-500">Could not load this day’s review.</p>;
  const pct = data.total_count ? Math.round((data.completed_count / data.total_count) * 100) : 0;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="card p-5 lg:col-span-2">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex min-w-0 items-center gap-1">
            <button className="btn-ghost p-2" onClick={() => shift(-1)} aria-label="Previous day"><ChevronLeft size={18} /></button>
            <span className="truncate font-bold">{fmtDay(`${date}T12:00:00`)} · {dt(`${date}T12:00:00`).toFormat('d LLL')}</span>
            <button className="btn-ghost p-2" disabled={date >= todayISO()} onClick={() => shift(1)} aria-label="Next day"><ChevronRight size={18} /></button>
          </div>
        </div>
        <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-center sm:gap-4">
          <ProgressRing value={pct} size={88} stroke={9} />
          <p className="text-center text-sm font-medium sm:text-left">
            {data.completed_count} of {data.total_count} tasks done
            {data.incomplete?.length ? ` · ${data.incomplete.length} still open` : data.total_count ? ' · nice work' : ''}
          </p>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <div>
            <p className="label">Completed</p>
            {data.completed.length ? data.completed.map((t) => (
              <p key={t.id} className="flex items-center gap-2 py-1 text-sm"><CheckCircle2 size={16} className="text-emerald-500" /> {t.category_icon} {t.title}</p>
            )) : <p className="text-sm text-slate-400">Nothing completed.</p>}
          </div>
          <div>
            <p className="label">Not completed</p>
            {data.incomplete.length ? data.incomplete.map((t) => (
              <div key={t.id} className="flex items-start gap-2 py-1.5 text-sm">
                <CircleDashed size={16} className="mt-0.5 shrink-0 text-amber-500" />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{t.title}</span>
                  <span className="text-xs text-slate-400">{fmtRange(t.start_at, t.end_at)}</span>
                </span>
                <button className="shrink-0 text-xs font-semibold text-brand-600 dark:text-brand-300" onClick={() => runAssistant(`Reschedule ${t.title}`, () => api.post('/assistant/reschedule', { task_id: t.id }))}>Reschedule</button>
              </div>
            )) : <p className="text-sm text-slate-400">All clear 🎉</p>}
          </div>
        </div>
      </div>
      <div className="card p-5">
        <p className="font-extrabold">How did today feel?</p>
        <div className="mt-3 flex justify-between gap-1">
          {MOODS.map((m, i) => (
            <button type="button" key={m} onClick={() => setMood(i + 1)} className={`h-12 w-12 rounded-2xl text-2xl transition ${mood === i + 1 ? 'scale-110 bg-brand-100 ring-2 ring-brand-400 dark:bg-brand-500/20' : 'bg-slate-50 dark:bg-white/5'}`}>{m}</button>
          ))}
        </div>
        <textarea
          className="input mt-4 min-h-[120px] resize-y"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="What went well? What got in the way?"
          autoComplete="off"
          autoCorrect="on"
          name="daily-reflection"
          data-lpignore="true"
          data-1p-ignore="true"
          data-gramm="false"
        />
        <button className="btn-primary mt-3 w-full" onClick={save} disabled={saving}>{saving && <Spinner size={16} />} Save reflection</button>
        <button className="btn-secondary mt-2 w-full" onClick={() => runAssistant('Plan tomorrow', () => api.post('/assistant/plan-day', { date: dt(`${date}T12:00:00`).plus({ days: 1 }).toISODate() }))}>
          <Sparkles size={16} className="text-brand-500" /> Plan tomorrow
        </button>
      </div>
    </div>
  );
}

function Weekly() {
  const runAssistant = useAssistantRun();
  const [start, setStart] = useState(now().startOf('week').toISODate());
  const { data, loading } = useApi(() => api.get('/reviews/weekly', { start }), [start], { topics: ['tasks'] });
  const shift = (n) => setStart(dt(`${start}T12:00:00`).plus({ weeks: n }).toISODate());
  if (loading && !data) return <PageLoader />;
  if (!data) return <p className="text-sm text-slate-500">Could not load this week’s review.</p>;
  const cats = Object.values(data.categories || {});
  const cards = [
    { label: 'Tasks completed', value: `${data.tasks_completed} / ${data.tasks_total}` },
    { label: 'Fitness', value: data.fitness },
    { label: 'Writing sessions', value: data.writing_sessions },
    { label: 'Freelance hours', value: `${data.freelance_hours}h` },
  ];
  return (
    <div>
      <div className="mb-4 flex items-center gap-1">
        <button className="btn-ghost p-2" onClick={() => shift(-1)} aria-label="Previous week"><ChevronLeft size={18} /></button>
        <span className="font-bold">Week of {dt(`${data.week_start}T12:00:00`).toFormat('d LLL yyyy')}</span>
        <button className="btn-ghost p-2" disabled={start >= now().startOf('week').toISODate()} onClick={() => shift(1)} aria-label="Next week"><ChevronRight size={18} /></button>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="card p-4">
            <p className="text-xs font-semibold text-slate-400">{c.label}</p>
            <p className="mt-1 text-2xl font-extrabold">{c.value}</p>
          </div>
        ))}
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <p className="mb-3 font-extrabold">By category</p>
          {cats.length ? cats.map((c) => (
            <div key={c.name} className="mb-2">
              <div className="flex justify-between text-sm"><span className="font-semibold">{c.name}</span><span className="text-slate-500">{c.done}/{c.planned}</span></div>
              <div className="mt-1 h-2 rounded-full bg-slate-100 dark:bg-ink-700"><div className="h-full rounded-full bg-gradient-to-r from-brand-500 to-violet-500" style={{ width: `${(c.done / Math.max(1, c.planned)) * 100}%` }} /></div>
            </div>
          )) : <p className="text-sm text-slate-400">No tasks this week.</p>}
        </div>
        <div className="card p-5">
          <p className="font-extrabold">Patterns</p>
          <p className="mt-2 text-sm">Most productive: <b>{data.most_productive || '—'}</b></p>
          <p className="text-sm">Most missed: <b>{data.most_missed || '—'}</b></p>
          <div className="mt-4 rounded-2xl bg-gradient-to-br from-brand-500 to-violet-600 p-4 text-white">
            <p className="flex items-center gap-2 text-sm font-bold"><Lightbulb size={16} /> Recommendation</p>
            <p className="mt-1 text-sm text-white/90">{data.recommendation}</p>
          </div>
          <button className="btn-secondary mt-3 w-full" onClick={() => runAssistant('Plan next week', () => api.post('/assistant/plan-week', { week: 'next' }))}>
            <Sparkles size={16} className="text-brand-500" /> Plan next week
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Review() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') === 'weekly' ? 'weekly' : 'daily');
  return (
    <div>
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="hidden md:block">
          <h1 className="text-2xl font-extrabold tracking-tight md:text-[28px]">Reviews</h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">Look back, then plan ahead</p>
        </div>
        <Segmented value={tab} onChange={setTab} options={[{ value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }]} />
      </div>
      {tab === 'daily' ? <Daily /> : <Weekly />}
    </div>
  );
}
