import { useState } from 'react';
import { AlertTriangle, Check, Clock, X, Sparkles, ArrowRight, Bell, AlarmClock } from 'lucide-react';
import { api } from '../../services/api';
import { emit } from '../../services/bus';
import { fmtDay, fmtRange, fmtTime, dt } from '../../utils/format';
import { useToast } from '../../context/ToastContext';

function Timeline({ items }) {
  return (
    <ol className="mt-2 space-y-1.5">
      {items.map((i, idx) => (
        <li key={idx} className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm ${i.kind === 'proposed' ? 'bg-brand-50 font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-200' : 'text-slate-500 dark:text-slate-400'}`}>
          <span className="w-24 shrink-0 tabular-nums">{i.kind === 'marker' ? fmtTime(i.start_at) : fmtRange(i.start_at, i.end_at).replace(/ (AM|PM)/g, (m) => m.toLowerCase())}</span>
          <span className="flex-1 truncate">{i.icon ? `${i.icon} ` : ''}{i.title}</span>
          {i.kind === 'proposed' && (
            <span className="flex gap-1 text-brand-500">
              <Bell size={13} />
              {i.alarm && <AlarmClock size={13} />}
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

function WeekPlan({ days }) {
  return (
    <div className="mt-2 grid gap-2 sm:grid-cols-2">
      {days.map((d) => (
        <div key={d.date} className={`rounded-xl border p-3 text-sm ${d.overloaded ? 'border-amber-300 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/5' : 'border-slate-100 dark:border-white/5'}`}>
          <div className="mb-1 flex items-center justify-between">
            <span className="font-bold">{d.label}</span>
            <span className={`text-[11px] font-semibold ${d.overloaded ? 'text-amber-600' : 'text-slate-400'}`}>
              {Math.round((d.load_minutes / 60) * 10) / 10}h {d.overloaded && '· heavy'}
            </span>
          </div>
          <div className="mb-1.5 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-ink-700">
            <div className={`h-full rounded-full ${d.overloaded ? 'bg-amber-400' : 'bg-gradient-to-r from-brand-500 to-violet-500'}`} style={{ width: `${Math.min(100, (d.load_minutes / d.capacity_minutes) * 100)}%` }} />
          </div>
          {d.proposed.length === 0 && d.existing.length === 0 && <p className="text-xs text-slate-400">Free</p>}
          {d.existing.map((e) => (
            <p key={`e${e.task_id}`} className="truncate text-xs text-slate-400">{fmtTime(e.start_at)} {e.title}</p>
          ))}
          {d.proposed.map((p, i) => (
            <p key={i} className="truncate text-xs font-semibold text-brand-600 dark:text-brand-300">
              + {fmtTime(p.start_at)} {p.title}{p.session ? ` (${p.session})` : ''}
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}

/** Renders an AI proposal and lets the user confirm, pick an alternative or dismiss. */
export default function ActionPreview({ action, onDone }) {
  const toast = useToast();
  const [status, setStatus] = useState(action.status);
  const [busy, setBusy] = useState(false);
  const [showAlternatives, setShowAlternatives] = useState(false);
  const p = action.preview || {};

  const confirm = async (body = {}) => {
    setBusy(true);
    try {
      const out = await api.post(`/assistant/actions/${action.id}/confirm`, body);
      setStatus('executed');
      toast(out.summary);
      emit('tasks');
      emit('alarms');
      emit('planner');
      onDone?.(out);
    } catch (err) {
      toast.error(err.message);
      if (err.status === 409) setStatus('failed');
    } finally {
      setBusy(false);
    }
  };
  const reject = async () => {
    await api.post(`/assistant/actions/${action.id}/reject`).catch(() => {});
    setStatus('rejected');
    onDone?.({ rejected: true });
  };

  const done = status !== 'proposed';
  return (
    <div className="mt-2 rounded-2xl border border-brand-100 bg-white p-4 shadow-sm dark:border-brand-500/20 dark:bg-ink-800">
      <div className="mb-2 flex items-center gap-2 text-sm font-bold">
        <Sparkles size={16} className="text-brand-500" />
        <span className="flex-1">{p.title}</span>
        {status === 'executed' && <span className="chip bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300"><Check size={12} /> Done</span>}
        {status === 'rejected' && <span className="chip bg-slate-100 text-slate-500 dark:bg-white/5">Dismissed</span>}
        {(status === 'expired' || status === 'failed') && <span className="chip bg-slate-100 text-slate-500 dark:bg-white/5">{status}</span>}
      </div>

      {p.kind === 'move' && (
        <div className="mb-2 flex flex-wrap items-center gap-2 text-sm">
          <span className="rounded-lg bg-slate-100 px-2 py-1 text-slate-500 line-through dark:bg-white/5">{p.from}</span>
          <ArrowRight size={14} className="text-slate-400" />
          <span className="rounded-lg bg-brand-50 px-2 py-1 font-semibold text-brand-700 dark:bg-brand-500/10 dark:text-brand-200">{p.to}</span>
        </div>
      )}

      {p.fields && p.kind !== 'move' && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
          {p.fields.map((f) => (
            <div key={f.label} className="contents">
              <dt className="text-slate-400">{f.label}</dt>
              <dd className="font-semibold">{f.value}</dd>
            </div>
          ))}
        </dl>
      )}

      {p.kind === 'tasks' && p.items && (
        <ul className="space-y-1 text-sm">
          {p.items.map((i, idx) => (
            <li key={idx} className="flex justify-between rounded-lg bg-slate-50 px-3 py-2 dark:bg-white/5">
              <span className="font-semibold">{i.title}</span>
              <span className="text-slate-500">{fmtDay(i.start_at)} · {fmtRange(i.start_at, i.end_at)}</span>
            </li>
          ))}
        </ul>
      )}
      {p.kind === 'plan_day' && <Timeline items={p.timeline} />}
      {p.kind === 'plan_week' && <WeekPlan days={p.days} />}

      {p.reason && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">💡 {p.reason}</p>}
      {p.warnings?.length > 0 && (
        <div className="mt-2 space-y-1">
          {p.warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5 text-xs font-medium text-amber-600 dark:text-amber-400">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {w}
            </p>
          ))}
        </div>
      )}

      {!done && (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <button className={p.kind === 'cancel' ? 'btn-danger' : 'btn-primary'} disabled={busy} onClick={() => confirm()}>
              <Check size={16} /> {p.kind === 'cancel' ? 'Yes, remove' : p.kind?.startsWith('plan') ? 'Accept plan' : 'Confirm'}
            </button>
            {p.alternatives?.length > 0 && (
              <button className="btn-secondary" onClick={() => setShowAlternatives((s) => !s)}>
                <Clock size={16} /> Choose another time
              </button>
            )}
            <button className="btn-ghost" onClick={reject} disabled={busy}>
              <X size={16} /> Not now
            </button>
          </div>
          {showAlternatives && (
            <div className="mt-2 space-y-1.5">
              {p.alternatives.map((alt, i) => (
                <button key={alt.start_at} disabled={busy} onClick={() => confirm({ alternative_index: i })} className="flex w-full items-center justify-between rounded-xl border border-slate-200 px-3 py-2 text-left text-sm hover:border-brand-300 hover:bg-brand-50 dark:border-white/10 dark:hover:bg-brand-500/10">
                  <span className="font-semibold">{fmtDay(alt.start_at)}, {fmtRange(alt.start_at, alt.end_at)}</span>
                  <span className="text-xs text-slate-400">{dt(alt.start_at).toFormat('ccc d LLL')}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
