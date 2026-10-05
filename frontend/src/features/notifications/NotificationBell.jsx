import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, Settings, Trash2 } from 'lucide-react';
import { api } from '../../services/api';
import { on } from '../../services/bus';
import { useApi } from '../../hooks/useApi';
import { fmtRelative } from '../../utils/format';
import { useToast } from '../../context/ToastContext';

export const TYPE_DOT = {
  alarm: 'bg-rose-500',
  alarm_reminder: 'bg-rose-400',
  task_reminder: 'bg-rose-400',
  deadline: 'bg-amber-400',
  missed_task: 'bg-slate-400',
  daily_briefing: 'bg-sky-400',
  weekly_planning: 'bg-brand-500',
  daily_review: 'bg-violet-400',
  reminder: 'bg-brand-400',
};

export function NotificationItem({ n, onOpen, onRead, onDelete, compact }) {
  return (
    <div className={`group flex items-start gap-3 rounded-xl px-3 py-2.5 transition hover:bg-slate-50 dark:hover:bg-white/5 ${n.read_at ? 'opacity-70' : ''}`}>
      <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${TYPE_DOT[n.notification_type] || 'bg-brand-400'}`} />
      <button className="min-w-0 flex-1 text-left" onClick={() => onOpen(n)}>
        <p className={`text-sm ${n.read_at ? 'font-medium' : 'font-bold'}`}>{n.title}</p>
        {n.message && <p className={`text-xs text-slate-500 dark:text-slate-400 ${compact ? 'truncate' : ''}`}>{n.message}</p>}
        <p className="mt-0.5 text-[11px] text-slate-400">{fmtRelative(n.sent_at)}</p>
      </button>
      <div className="flex gap-1 opacity-100 md:opacity-0 md:group-hover:opacity-100">
        {!n.read_at && (
          <button onClick={() => onRead(n)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-brand-500 dark:hover:bg-white/10" title="Mark as read">
            <CheckCheck size={15} />
          </button>
        )}
        <button onClick={() => onDelete(n)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-rose-500 dark:hover:bg-white/10" title="Delete">
          <Trash2 size={15} />
        </button>
      </div>
    </div>
  );
}

export function useNotificationActions(reload) {
  const navigate = useNavigate();
  return {
    open: async (n) => {
      if (!n.read_at) await api.put(`/notifications/${n.id}/read`).catch(() => {});
      reload();
      navigate(n.data?.url || (n.task_id ? `/tasks?open=${n.task_id}` : '/notifications'));
    },
    read: async (n) => {
      await api.put(`/notifications/${n.id}/read`);
      reload();
    },
    remove: async (n) => {
      await api.del(`/notifications/${n.id}`);
      reload();
    },
    readAll: async () => {
      await api.post('/notifications/read-all');
      reload();
    },
  };
}

export default function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const toast = useToast();
  const { data, reload } = useApi(() => api.get('/notifications', { limit: 15 }), [], { topics: ['notifications'], initial: { notifications: [], unread: 0 } });
  const actions = useNotificationActions(reload);
  const list = data?.notifications || [];
  const unread = data?.unread || 0;

  useEffect(() => {
    const close = (e) => ref.current && !ref.current.contains(e.target) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  // In-app toast for live notifications while the site is open.
  useEffect(
    () =>
      on('server:notification', (n) => {
        if (n?.title) toast.info(`${n.title}${n.message ? `\n${n.message}` : ''}`, { duration: 7000 });
      }),
    [toast],
  );

  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen((o) => !o)} className="relative rounded-xl p-2.5 text-slate-500 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-white/5" aria-label={`Notifications (${unread} unread)`}>
        <Bell size={20} />
        {unread > 0 && (
          <span className="absolute right-1 top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white dark:ring-ink-900">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="card absolute right-0 z-40 mt-2 w-[min(92vw,380px)] overflow-hidden animate-slide-up">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3 dark:border-white/5">
            <span className="text-sm font-extrabold tracking-wide">NOTIFICATIONS</span>
            <div className="flex items-center gap-1">
              <button onClick={actions.readAll} className="rounded-lg px-2 py-1 text-xs font-semibold text-brand-600 hover:bg-brand-50 dark:text-brand-300 dark:hover:bg-white/5">Mark all read</button>
              <Link to="/settings#notifications" onClick={() => setOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5" title="Notification settings">
                <Settings size={15} />
              </Link>
            </div>
          </div>
          <div className="max-h-[60vh] overflow-y-auto p-2">
            {list.length === 0 && <p className="px-3 py-8 text-center text-sm text-slate-400">You're all caught up ✨</p>}
            {list.map((n) => (
              <NotificationItem key={n.id} n={n} compact onOpen={(x) => { setOpen(false); actions.open(x); }} onRead={actions.read} onDelete={actions.remove} />
            ))}
          </div>
          <Link to="/notifications" onClick={() => setOpen(false)} className="block border-t border-slate-100 py-2.5 text-center text-sm font-semibold text-brand-600 hover:bg-slate-50 dark:border-white/5 dark:text-brand-300 dark:hover:bg-white/5">
            View all
          </Link>
        </div>
      )}
    </div>
  );
}
