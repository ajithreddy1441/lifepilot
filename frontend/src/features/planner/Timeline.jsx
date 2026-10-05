import { AlarmClock, Check } from 'lucide-react';
import { fmtTime24, fmtRange, dt, now } from '../../utils/format';

const BLOCK_STYLE = {
  work: 'bg-sky-50 text-sky-700 dark:bg-sky-500/10 dark:text-sky-300',
  meal: 'bg-amber-50 text-amber-700 dark:bg-amber-500/10 dark:text-amber-300',
  block: 'bg-slate-50 text-slate-600 dark:bg-white/5 dark:text-slate-300',
};

/** Vertical day timeline: markers (wake/sleep), fixed blocks, tasks and alarms. */
export default function Timeline({ items = [], alarms = [], onOpenTask, compact = false }) {
  const n = now();
  const alarmByTask = new Set(alarms.map((a) => a.task_id).filter(Boolean));
  const merged = [
    ...items,
    ...alarms.filter((a) => !a.task_id).map((a) => ({ kind: 'alarm', title: a.title, start_at: a.at, end_at: a.at })),
  ].sort((a, b) => a.start_at.localeCompare(b.start_at));

  return (
    <ol className="relative">
      {merged.map((i, idx) => {
        const start = dt(i.start_at);
        const end = dt(i.end_at);
        const isNow = i.kind === 'task' && start <= n && end > n;
        const past = end < n;
        const done = i.task?.status === 'completed';
        return (
          <li key={idx} className="relative flex gap-3 pb-1">
            <span className={`w-12 shrink-0 pt-2.5 text-right text-xs font-semibold tabular-nums ${isNow ? 'text-brand-600 dark:text-brand-300' : 'text-slate-400'}`}>{fmtTime24(i.start_at)}</span>
            <span className="relative flex flex-col items-center">
              <span className={`mt-3 h-3 w-3 rounded-full border-2 ${isNow ? 'border-brand-500 bg-brand-500 ring-4 ring-brand-500/20' : done ? 'border-emerald-400 bg-emerald-400' : past ? 'border-slate-300 bg-slate-200 dark:border-slate-600 dark:bg-slate-700' : 'border-brand-400 bg-white dark:bg-ink-850'}`} />
              {idx < merged.length - 1 && <span className="w-px flex-1 bg-slate-200 dark:bg-white/10" />}
            </span>
            {i.kind === 'marker' || i.kind === 'alarm' ? (
              <div className="flex flex-1 items-center gap-2 py-2 text-sm font-medium text-slate-500 dark:text-slate-400">
                {i.kind === 'alarm' ? <AlarmClock size={14} className="text-rose-500" /> : <span>{i.icon}</span>}
                {i.title}
              </div>
            ) : i.kind === 'block' ? (
              <div className={`mb-1 flex-1 rounded-xl px-3 py-2 text-sm ${BLOCK_STYLE[i.block_type === 'work' ? 'work' : i.block_type === 'meal' ? 'meal' : 'block']}`}>
                <p className="font-semibold">{i.icon} {i.title}</p>
                {!compact && <p className="text-xs opacity-75">{fmtRange(i.start_at, i.end_at)}</p>}
              </div>
            ) : (
              <button
                onClick={() => onOpenTask?.(i.task)}
                className={`mb-1 flex flex-1 items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition hover:border-brand-300 ${isNow ? 'border-brand-300 bg-brand-50 dark:border-brand-500/40 dark:bg-brand-500/10' : 'border-slate-100 bg-white dark:border-white/5 dark:bg-ink-800'}`}
              >
                <span className="text-base">{i.task?.category_icon || '📌'}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block truncate font-semibold ${done ? 'text-slate-400 line-through' : ''}`}>{i.title}</span>
                  {!compact && <span className="block text-xs text-slate-500 dark:text-slate-400">{fmtRange(i.start_at, i.end_at)}</span>}
                </span>
                {done && <Check size={16} className="text-emerald-500" />}
                {(i.task?.alarm_enabled || alarmByTask.has(i.task?.id)) && <AlarmClock size={14} className="text-brand-500" />}
                {isNow && <span className="chip bg-brand-500 text-white">Now</span>}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}
