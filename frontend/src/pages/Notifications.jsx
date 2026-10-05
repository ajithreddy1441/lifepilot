import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Bell, CheckCheck, Settings, Send, Clock } from 'lucide-react';
import { api } from '../services/api';
import { useApi } from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { PageHeader, PageLoader, Empty, Segmented } from '../components/ui';
import { NotificationItem, useNotificationActions, TYPE_DOT } from '../features/notifications/NotificationBell';
import PermissionBanner from '../features/notifications/PermissionBanner';
import { fmtDay, fmtTime } from '../utils/format';

export default function Notifications() {
  const toast = useToast();
  const [filter, setFilter] = useState('all');
  const { data, loading, reload } = useApi(() => api.get('/notifications', { filter, limit: 100 }), [filter], { topics: ['notifications'] });
  const { data: upcoming } = useApi(() => api.get('/notifications/upcoming').then((r) => r.notifications), [], { topics: ['notifications', 'tasks', 'alarms'], initial: [] });
  const actions = useNotificationActions(reload);

  const test = async () => {
    try {
      await api.post('/notifications/test');
      toast('Test notification sent to all your devices');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle={data ? `${data.unread} unread` : ''}
        actions={
          <>
            <button className="btn-secondary" onClick={test}><Send size={16} /> Test</button>
            <button className="btn-secondary" onClick={actions.readAll}><CheckCheck size={16} /> Mark all read</button>
            <Link to="/settings#notifications" className="btn-ghost" aria-label="Notification settings"><Settings size={16} /></Link>
          </>
        }
      />
      <PermissionBanner />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Segmented
            className="mb-3"
            value={filter}
            onChange={setFilter}
            options={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }, { value: 'reminders', label: 'Reminders' }, { value: 'ai', label: 'AI & briefings' }]}
          />
          <div className="card p-2">
            {loading && !data ? (
              <PageLoader />
            ) : data.notifications.length ? (
              data.notifications.map((n) => <NotificationItem key={n.id} n={n} onOpen={actions.open} onRead={actions.read} onDelete={actions.remove} />)
            ) : (
              <Empty icon={Bell} title="Nothing here" text="Reminders, alarms, deadlines and your daily briefing will show up here." />
            )}
          </div>
        </div>
        <div className="card h-fit p-5">
          <p className="mb-3 flex items-center gap-2 font-extrabold"><Clock size={16} /> Coming up</p>
          {upcoming.length ? (
            <ul className="space-y-2">
              {upcoming.map((n) => (
                <li key={n.id} className="flex items-start gap-2 text-sm">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${TYPE_DOT[n.notification_type] || 'bg-brand-400'}`} />
                  <span className="flex-1">
                    <span className="block font-semibold">{n.title}</span>
                    <span className="text-xs text-slate-400">{fmtDay(n.scheduled_at)} {fmtTime(n.scheduled_at)}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-400">No notifications scheduled.</p>
          )}
        </div>
      </div>
    </div>
  );
}
