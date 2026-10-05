import { useState } from 'react';
import { Shield, Search, Users, BookOpen, Activity, Smartphone, ListTodo, AlarmClock, Target, Repeat } from 'lucide-react';
import { api } from '../services/api';
import { useApi } from '../hooks/useApi';
import { PageHeader, PageLoader, Modal, Empty } from '../components/ui';
import { fmtRelative, fmtDay } from '../utils/format';

function Stat({ label, value, icon: Icon, accent }) {
  return (
    <div className="card p-4">
      <p className="flex items-center gap-2 text-xs font-semibold text-slate-400"><Icon size={14} className={accent || 'text-brand-500'} /> {label}</p>
      <p className="mt-2 text-3xl font-extrabold tabular-nums">{value ?? '—'}</p>
    </div>
  );
}

function MiniBars({ series = [], color = 'from-brand-500 to-violet-500' }) {
  const max = Math.max(1, ...series.map((d) => d.n));
  return (
    <div className="flex h-28 items-end gap-1">
      {series.map((d) => (
        <div key={d.date} className="group relative flex flex-1 flex-col items-center justify-end" title={`${d.date}: ${d.n}`}>
          <div className={`w-full rounded-t-md bg-gradient-to-t ${color}`} style={{ height: `${(d.n / max) * 100}%`, minHeight: d.n ? 4 : 2 }} />
        </div>
      ))}
    </div>
  );
}

function UserDetail({ id, onClose }) {
  const { data, loading } = useApi(() => api.get(`/admin/users/${id}`), [id]);
  return (
    <Modal open onClose={onClose} title={data?.user?.name || 'User'} wide>
      {loading || !data ? (
        <PageLoader />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-sm md:grid-cols-4">
            <p><span className="text-slate-400">Email</span><br /><b>{data.user.email}</b></p>
            <p><span className="text-slate-400">Role</span><br /><b className="capitalize">{data.user.role}</b></p>
            <p><span className="text-slate-400">Timezone</span><br /><b>{data.user.timezone}</b></p>
            <p><span className="text-slate-400">Last seen</span><br /><b>{data.user.last_seen_at ? fmtRelative(data.user.last_seen_at) : 'Never'}</b></p>
          </div>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-6">
            {Object.entries(data.stats).map(([k, v]) => (
              <div key={k} className="rounded-xl bg-slate-50 px-3 py-2 text-center dark:bg-white/5">
                <p className="text-lg font-extrabold">{v}</p>
                <p className="text-[11px] capitalize text-slate-400">{k}</p>
              </div>
            ))}
          </div>
          {data.preferences && (
            <p className="text-sm text-slate-500">Wake {String(data.preferences.wake_time || '').slice(0, 5)} · Sleep {String(data.preferences.sleep_time || '').slice(0, 5)} · Work {String(data.preferences.work_start || '').slice(0, 5)}–{String(data.preferences.work_end || '').slice(0, 5)} · {data.preferences.onboarded ? 'Onboarded' : 'Not onboarded'}</p>
          )}
          <div>
            <p className="mb-2 font-extrabold">Devices</p>
            {data.devices.length ? data.devices.map((d) => (
              <p key={d.id} className="text-sm">{d.device_name} · {d.platform} · {d.last_seen ? fmtRelative(d.last_seen) : 'never'}</p>
            )) : <p className="text-sm text-slate-400">No devices.</p>}
          </div>
          <div>
            <p className="mb-2 font-extrabold">Recent tasks</p>
            {data.recent_tasks.length ? data.recent_tasks.map((t) => (
              <p key={t.id} className="flex justify-between text-sm">
                <span>{t.category_name ? `${t.category_name} · ` : ''}{t.title}</span>
                <span className="text-slate-400">{t.status}{t.start_at ? ` · ${fmtDay(t.start_at)}` : ''}</span>
              </p>
            )) : <p className="text-sm text-slate-400">No tasks yet.</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}

export default function Admin() {
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);
  const { data: overview, loading: loadingOverview } = useApi(() => api.get('/admin/overview'), []);
  const { data: usersRes, loading: loadingUsers } = useApi(() => api.get('/admin/users', { q: q || undefined }).then((r) => r.users), [q], { initial: [] });

  if (loadingOverview && !overview) return <PageLoader />;

  const t = overview?.totals || {};
  const readers = overview?.readers || {};
  const story = overview?.story_readers || {};

  return (
    <div>
      <PageHeader title="Admin" subtitle="Users, readers, and everything happening on LifePilot" />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Daily readers" value={readers.daily} icon={Activity} />
        <Stat label="Weekly readers" value={readers.weekly} icon={Users} />
        <Stat label="Yearly readers" value={readers.yearly} icon={Users} />
        <Stat label="Users" value={t.users} icon={Users} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Daily story readers" value={story.daily} icon={BookOpen} accent="text-amber-500" />
        <Stat label="Weekly story readers" value={story.weekly} icon={BookOpen} accent="text-amber-500" />
        <Stat label="Yearly story readers" value={story.yearly} icon={BookOpen} accent="text-amber-500" />
        <Stat label="New users today" value={t.new_users_today} icon={Shield} />
      </div>

      <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Stat label="Tasks" value={t.tasks} icon={ListTodo} />
        <Stat label="Alarms" value={t.alarms} icon={AlarmClock} />
        <Stat label="Devices" value={t.devices} icon={Smartphone} />
        <Stat label="Habits" value={t.habits} icon={Repeat} />
        <Stat label="Goals" value={t.goals} icon={Target} />
        <Stat label="Notifs today" value={t.notifications_sent_today} icon={Activity} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="card p-5">
          <p className="font-extrabold">Readers — last 14 days</p>
          <p className="text-xs text-slate-400">Unique people who opened the app</p>
          <MiniBars series={overview?.charts?.readers_14d} />
        </div>
        <div className="card p-5">
          <p className="font-extrabold">Story readers — last 14 days</p>
          <p className="text-xs text-slate-400">Unique people with story / creative work</p>
          <MiniBars series={overview?.charts?.story_readers_14d} color="from-amber-400 to-fuchsia-500" />
        </div>
      </div>

      <div className="mt-6">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-extrabold">Users</h2>
          <div className="relative w-full max-w-xs">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className="input pl-9" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>
        <div className="card overflow-x-auto">
          {loadingUsers && !usersRes?.length ? (
            <PageLoader />
          ) : usersRes.length ? (
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-400">
                <tr>
                  {['Name', 'Email', 'Role', 'Last seen', 'Tasks', 'Alarms', 'Devices', 'Reader days', 'Story days'].map((h) => (
                    <th key={h} className="px-3 py-2 font-semibold">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {usersRes.map((u) => (
                  <tr key={u.id} onClick={() => setOpenId(u.id)} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50 dark:border-white/5 dark:hover:bg-white/5">
                    <td className="px-3 py-2.5 font-semibold">{u.name}</td>
                    <td className="px-3 py-2.5 text-slate-500">{u.email}</td>
                    <td className="px-3 py-2.5"><span className={`chip capitalize ${u.role === 'admin' ? 'bg-brand-50 text-brand-600 dark:bg-brand-500/10' : 'bg-slate-100 text-slate-500 dark:bg-white/5'}`}>{u.role}</span></td>
                    <td className="px-3 py-2.5 text-slate-500">{u.last_seen_at ? fmtRelative(u.last_seen_at) : '—'}</td>
                    <td className="px-3 py-2.5">{u.tasks}</td>
                    <td className="px-3 py-2.5">{u.alarms}</td>
                    <td className="px-3 py-2.5">{u.devices}</td>
                    <td className="px-3 py-2.5">{u.reader_days}</td>
                    <td className="px-3 py-2.5">{u.story_days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty icon={Users} title="No users yet" text="People who sign up will appear here. Reader counts grow as they open the app." />
          )}
        </div>
      </div>

      {openId && <UserDetail id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}
