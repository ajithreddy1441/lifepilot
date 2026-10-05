import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, AlarmClock, Bell, Mic, Sparkles, CalendarRange, Play, RefreshCw, ChevronRight, Sun } from 'lucide-react';
import { api } from '../services/api';
import { emit } from '../services/bus';
import { useApi } from '../hooks/useApi';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { useVoice } from '../features/voice/VoiceContext';
import { useAssistantRun } from '../features/assistant/AssistantResult';
import { ProgressRing, PageLoader } from '../components/ui';
import Timeline from '../features/planner/Timeline';
import TaskForm from '../features/tasks/TaskForm';
import AlarmForm from '../features/alarms/AlarmForm';
import PermissionBanner from '../features/notifications/PermissionBanner';
import { greeting, now, fmtRange, fmtTime, fmtDay, dt, minutesLabel } from '../utils/format';

export default function Dashboard() {
  const { user } = useAuth();
  const toast = useToast();
  const { openVoice } = useVoice();
  const runAssistant = useAssistantRun();
  const [taskForm, setTaskForm] = useState(null);
  const [alarmOpen, setAlarmOpen] = useState(false);
  const { data, loading } = useApi(() => api.get('/planner/today'), [], { topics: ['tasks', 'alarms', 'planner'] });
  const { data: alarms = [] } = useApi(() => api.get('/alarms').then((r) => r.alarms), [], { topics: ['alarms'], initial: [] });

  if (loading && !data) return <PageLoader />;
  const { timeline = [], progress = {}, next_up: next, alarms: alarmsToday = [] } = data || {};
  const tasks = timeline.filter((i) => i.kind === 'task');
  const n = now();
  const current = tasks.find((t) => dt(t.start_at) <= n && dt(t.end_at) > n && t.task.status !== 'completed');
  const upcoming = tasks.filter((t) => dt(t.start_at) > n && t.task.status !== 'completed');
  const then = current ? upcoming[0] : upcoming.find((t) => t.task.id !== next?.id);
  const focusMinutes = tasks.filter((t) => t.task.status === 'completed').reduce((s, t) => s + t.task.duration_minutes, 0);
  const nextAlarm = alarms.filter((a) => a.enabled && a.next_trigger_at).sort((a, b) => a.next_trigger_at.localeCompare(b.next_trigger_at))[0];

  const start = async (task) => {
    await api.put(`/tasks/${task.id}`, { status: 'in_progress' });
    emit('tasks');
    toast(`Started: ${task.title}. Focus mode on 💪`);
  };

  const quick = [
    { label: 'Task', icon: Plus, onClick: () => setTaskForm({}) },
    { label: 'Alarm', icon: AlarmClock, onClick: () => setAlarmOpen(true) },
    { label: 'Reminder', icon: Bell, onClick: () => setTaskForm({ defaults: { alarm_enabled: false, reminder_minutes: 10 } }) },
    { label: 'Voice', icon: Mic, onClick: openVoice },
    { label: 'Plan My Day', icon: Sparkles, onClick: () => runAssistant('Plan my day', () => api.post('/assistant/plan-day', {})), ai: true },
    { label: 'Plan My Week', icon: CalendarRange, onClick: () => runAssistant('Plan my week', () => api.post('/assistant/plan-week', {})), ai: true },
  ];

  return (
    <div>
      <PermissionBanner />
      <div className="mb-5 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight md:text-3xl">
            {greeting()}, <span className="gradient-text">{user?.name?.split(' ')[0] || 'there'}</span> 👋
          </h1>
          <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{n.toFormat('cccc, d LLLL')}</p>
        </div>
        <div className="hidden items-center gap-2 rounded-2xl bg-white px-4 py-2 text-sm font-semibold shadow-sm sm:flex dark:bg-ink-850">
          <Sun size={18} className="text-amber-400" /> {n.toFormat('h:mm a')}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {/* Progress */}
        <div className="card flex items-center gap-5 p-5">
          <ProgressRing value={progress.percent || 0} size={104} label="done" />
          <div className="flex-1">
            <p className="text-sm font-bold text-slate-500 dark:text-slate-400">Today’s Progress</p>
            <p className="mt-1 text-lg font-extrabold">{progress.completed || 0} of {progress.total || 0} tasks</p>
            <div className="mt-3 grid grid-cols-2 gap-2 text-center">
              <div className="rounded-xl bg-slate-50 py-2 dark:bg-white/5">
                <p className="text-lg font-extrabold">{alarmsToday.length}</p>
                <p className="text-[11px] text-slate-400">Alarms</p>
              </div>
              <div className="rounded-xl bg-slate-50 py-2 dark:bg-white/5">
                <p className="text-lg font-extrabold">{minutesLabel(focusMinutes)}</p>
                <p className="text-[11px] text-slate-400">Focus</p>
              </div>
            </div>
          </div>
        </div>

        {/* Now / Next up */}
        <div className="card relative overflow-hidden p-5 lg:col-span-2">
          <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gradient-to-br from-brand-400/20 to-fuchsia-400/20 blur-2xl" />
          <p className="text-xs font-extrabold tracking-widest text-brand-600 dark:text-brand-300">{current ? 'DO THIS NOW' : 'NEXT UP'}</p>
          {current || next ? (
            (() => {
              const t = current ? current.task : next;
              return (
                <div className="relative mt-2">
                  <div className="flex items-start gap-3">
                    <span className="text-3xl">{t.category_icon || '📌'}</span>
                    <div className="flex-1">
                      <p className="text-xl font-extrabold">{t.title}</p>
                      <p className="text-sm text-slate-500 dark:text-slate-400">
                        {fmtDay(t.start_at) !== 'Today' && `${fmtDay(t.start_at)} · `}
                        {fmtRange(t.start_at, t.end_at)}
                        {t.category_name && ` · ${t.category_name}`}
                      </p>
                      <p className="mt-1 flex flex-wrap gap-3 text-xs font-semibold">
                        {(t.alarm_id || t.alarm_enabled) && <span className="flex items-center gap-1 text-brand-600 dark:text-brand-300"><AlarmClock size={13} /> Alarm enabled</span>}
                        {t.reminder_minutes !== null && t.reminder_minutes !== undefined && <span className="flex items-center gap-1 text-slate-500"><Bell size={13} /> Reminder {t.reminder_minutes} min before</span>}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {t.status !== 'in_progress' && (
                      <button className="btn-primary" onClick={() => start(t)}><Play size={16} /> Start</button>
                    )}
                    <button className="btn-secondary" onClick={() => runAssistant(`Reschedule ${t.title}`, () => api.post('/assistant/reschedule', { task_id: t.id }))}>
                      <RefreshCw size={16} /> Reschedule
                    </button>
                    <button className="btn-ghost" onClick={() => setTaskForm({ task: t })}>Details</button>
                  </div>
                  {then && (
                    <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-500 dark:border-white/5 dark:text-slate-400">
                      Then: <span className="font-semibold text-slate-700 dark:text-slate-200">{then.task.title}</span> at {fmtTime(then.start_at)}
                    </p>
                  )}
                </div>
              );
            })()
          ) : (
            <div className="relative mt-3">
              <p className="text-lg font-bold">Nothing scheduled next.</p>
              <p className="text-sm text-slate-500">Tell me what you need to do and I’ll find the best time.</p>
              <button className="btn-primary mt-3" onClick={() => runAssistant('Plan my day', () => api.post('/assistant/plan-day', {}))}>
                <Sparkles size={16} /> Plan my day
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Quick actions */}
      <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
        {quick.map((q) => (
          <button key={q.label} onClick={q.onClick} className={`card flex flex-col items-center gap-1.5 px-2 py-3 text-xs font-semibold transition hover:-translate-y-0.5 hover:border-brand-200 ${q.ai ? 'text-brand-600 dark:text-brand-300' : ''}`}>
            <span className={`flex h-10 w-10 items-center justify-center rounded-xl ${q.ai ? 'bg-gradient-to-br from-brand-500 to-violet-500 text-white' : 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300'}`}>
              <q.icon size={19} />
            </span>
            {q.label}
          </button>
        ))}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="font-extrabold">Today’s Schedule</h3>
            <Link to="/today" className="flex items-center text-sm font-semibold text-brand-600 dark:text-brand-300">Open <ChevronRight size={16} /></Link>
          </div>
          <Timeline items={timeline} alarms={alarmsToday} onOpenTask={(t) => setTaskForm({ task: t })} compact />
        </div>
        <div className="space-y-4">
          <div className="card p-5">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-extrabold">Alarms</h3>
              <Link to="/alarms" className="text-sm font-semibold text-brand-600 dark:text-brand-300">Manage</Link>
            </div>
            {nextAlarm ? (
              <div className="rounded-2xl bg-gradient-to-br from-ink-900 to-[#1e2557] p-4 text-white">
                <p className="text-xs text-slate-300">Next alarm · {fmtDay(nextAlarm.next_trigger_at)}</p>
                <p className="text-3xl font-extrabold">{fmtTime(nextAlarm.next_trigger_at)}</p>
                <p className="text-sm font-semibold">{nextAlarm.title}</p>
                <p className="text-xs text-slate-400">{nextAlarm.repeat_label}</p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">No alarms yet.</p>
            )}
            <ul className="mt-3 space-y-1">
              {alarms.filter((a) => a.enabled).slice(0, 4).map((a) => (
                <li key={a.id} className="flex items-center justify-between text-sm">
                  <span className="font-semibold">{a.alarm_time} · {a.title}</span>
                  <span className="text-xs text-slate-400">{a.repeat_label}</span>
                </li>
              ))}
            </ul>
          </div>
          <div className="card bg-gradient-to-br from-brand-500 to-violet-600 p-5 text-white">
            <p className="flex items-center gap-2 text-sm font-bold"><Sparkles size={16} /> AI Assistant</p>
            <p className="mt-2 text-sm text-white/85">Try: “Tomorrow at 6:40 AM remind me to workout for 40 minutes.”</p>
            <button onClick={openVoice} className="btn mt-3 bg-white/15 text-white hover:bg-white/25"><Mic size={16} /> Tap to speak</button>
          </div>
        </div>
      </div>

      <TaskForm open={!!taskForm} task={taskForm?.task} defaults={taskForm?.defaults} onClose={() => setTaskForm(null)} />
      <AlarmForm open={alarmOpen} onClose={() => setAlarmOpen(false)} />
    </div>
  );
}
