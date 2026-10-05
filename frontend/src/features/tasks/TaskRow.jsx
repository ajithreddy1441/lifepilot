import { Check, AlarmClock, Bell, Clock, Sparkles } from 'lucide-react';
import { api } from '../../services/api';
import { emit } from '../../services/bus';
import { CategoryDot } from '../../components/ui';
import { fmtRange, fmtDay, PRIORITY_STYLES, minutesLabel } from '../../utils/format';
import { useToast } from '../../context/ToastContext';

export default function TaskRow({ task, onOpen, showDate = false, onReschedule }) {
  const toast = useToast();
  const done = task.status === 'completed';

  const toggle = async (e) => {
    e.stopPropagation();
    try {
      if (done) await api.put(`/tasks/${task.id}`, { status: 'pending' });
      else await api.post(`/tasks/${task.id}/complete`);
      emit('tasks');
      if (!done) toast(`Completed: ${task.title}`, 'success', { action: { label: 'Undo', onClick: async () => { await api.put(`/tasks/${task.id}`, { status: 'pending' }); emit('tasks'); } } });
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div onClick={() => onOpen?.(task)} className="group flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 transition hover:bg-slate-50 dark:hover:bg-white/5">
      <button
        onClick={toggle}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${done ? 'border-transparent bg-gradient-to-br from-emerald-400 to-teal-500 text-white' : 'border-slate-300 hover:border-brand-400 dark:border-slate-600'}`}
        aria-label={done ? 'Mark as not done' : 'Mark as done'}
      >
        {done && <Check size={14} strokeWidth={3} />}
      </button>
      <CategoryDot color={task.category_color} icon={task.category_icon} />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-semibold ${done ? 'text-slate-400 line-through' : ''}`}>{task.title}</p>
        <p className="flex items-center gap-1.5 truncate text-xs text-slate-500 dark:text-slate-400">
          <Clock size={12} />
          {task.start_at ? `${showDate ? `${fmtDay(task.start_at)} · ` : ''}${fmtRange(task.start_at, task.end_at)}` : `Unscheduled · ${minutesLabel(task.duration_minutes)}`}
          {task.due_at && <span className="text-amber-600 dark:text-amber-400">· due {fmtDay(task.due_at)}</span>}
          {task.status === 'missed' && <span className="font-semibold text-rose-500">· missed</span>}
        </p>
      </div>
      <div className="flex items-center gap-1.5">
        {task.alarm_id && <AlarmClock size={15} className="text-brand-500" title="Phone alarm" />}
        {!task.alarm_id && task.reminder_minutes !== null && task.start_at && <Bell size={14} className="text-slate-400" />}
        <span className={`chip hidden capitalize sm:inline-flex ${PRIORITY_STYLES[task.priority]}`}>{task.priority}</span>
        {onReschedule && !done && (
          <button onClick={(e) => { e.stopPropagation(); onReschedule(task); }} className="rounded-lg p-1.5 text-slate-400 opacity-100 hover:bg-brand-50 hover:text-brand-500 md:opacity-0 md:group-hover:opacity-100 dark:hover:bg-white/10" title="AI reschedule">
            <Sparkles size={15} />
          </button>
        )}
      </div>
    </div>
  );
}
