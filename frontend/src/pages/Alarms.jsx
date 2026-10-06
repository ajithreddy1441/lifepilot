import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, AlarmClock, Smartphone, FlaskConical, CalendarClock, Pencil, CheckCircle2, CircleDashed, AlertCircle, Vibrate, Volume2 } from 'lucide-react';
import { api } from '../services/api';
import { emit } from '../services/bus';
import { useApi } from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { PageHeader, PageLoader, Empty, Toggle, Modal, Spinner } from '../components/ui';
import AlarmForm from '../features/alarms/AlarmForm';
import { fmtDay, fmtTime, fmtRelative } from '../utils/format';
import { isAndroidApp } from '../services/native/platform';
import { scheduleTestAlarm, syncAlarms } from '../services/native/alarmSync';

function SyncBadge({ alarm }) {
  const phones = (alarm.sync || []).filter((s) => s.platform === 'android');
  if (!alarm.enabled) return null;
  if (!phones.length) return <span className="chip bg-slate-100 text-slate-500 dark:bg-white/5"><CircleDashed size={12} /> Not on a phone yet</span>;
  const ok = phones.filter((s) => s.up_to_date && s.status === 'scheduled');
  const failed = phones.find((s) => s.status === 'failed');
  if (failed) return <span className="chip bg-rose-50 text-rose-600 dark:bg-rose-500/10" title={failed.error}><AlertCircle size={12} /> Sync failed on {failed.device_name}</span>;
  if (ok.length) return <span className="chip bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300"><CheckCircle2 size={12} /> On {ok.map((s) => s.device_name).join(', ')}</span>;
  if (isAndroidApp) return <span className="chip bg-amber-50 text-amber-600 dark:bg-amber-500/10"><CircleDashed size={12} /> Updating this phone…</span>;
  return <span className="chip bg-amber-50 text-amber-600 dark:bg-amber-500/10"><CircleDashed size={12} /> Syncing…</span>;
}

function ScheduleModal({ alarmId, onClose }) {
  const { data, loading } = useApi(() => (alarmId ? api.get(`/alarms/${alarmId}`).then((r) => r.alarm) : Promise.resolve(null)), [alarmId]);
  return (
    <Modal open={!!alarmId} onClose={onClose} title="Upcoming rings">
      {loading || !data ? (
        <div className="py-8 text-center"><Spinner /></div>
      ) : (
        <div>
          <p className="mb-3 text-sm text-slate-500">{data.title} · {data.repeat_label} · {data.timezone}</p>
          {data.upcoming.length ? (
            <ul className="space-y-1.5">
              {data.upcoming.map((u) => (
                <li key={u} className="flex justify-between rounded-xl bg-slate-50 px-3 py-2 text-sm dark:bg-white/5">
                  <span className="font-semibold">{fmtDay(u)}</span>
                  <span>{fmtTime(u)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No upcoming rings — the alarm is off or has finished.</p>
          )}
          {!!data.sync?.length && (
            <div className="mt-4">
              <p className="label">Devices</p>
              {data.sync.map((s) => (
                <p key={s.device_id} className="text-sm">
                  {s.device_name}: <span className={s.up_to_date ? 'text-emerald-600' : 'text-amber-600'}>{s.status}{s.up_to_date ? '' : ' (outdated)'}</span>
                  {s.synced_at && <span className="text-slate-400"> · {fmtRelative(s.synced_at)}</span>}
                </p>
              ))}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function Alarms() {
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [form, setForm] = useState(null);
  const [scheduleFor, setScheduleFor] = useState(null);
  const { data: alarms, setData, loading } = useApi(() => api.get('/alarms').then((r) => r.alarms), [], { topics: ['alarms'], initial: [] });
  const { data: devices } = useApi(() => api.get('/devices').then((r) => r.devices), [], { topics: ['devices'], initial: [] });
  const phones = devices.filter((d) => d.platform === 'android' && d.is_active);

  useEffect(() => {
    const open = params.get('open');
    if (params.get('new')) setForm({});
    if (open) api.get(`/alarms/${open}`).then(({ alarm }) => setForm({ alarm })).catch(() => toast.error('That alarm no longer exists'));
    if (open || params.get('new')) setParams({}, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const toggle = async (a, on) => {
    setData((list) => list.map((x) => (x.id === a.id ? { ...x, enabled: on, sync: on ? x.sync : [] } : x)));
    try {
      const { alarm } = await api.post(`/alarms/${a.id}/${on ? 'enable' : 'disable'}`);
      setData((list) => list.map((x) => (x.id === a.id ? alarm : x)));
      if (isAndroidApp) {
        await syncAlarms('toggle');
      } else {
        emit('alarms');
      }
    } catch (err) {
      toast.error(err.message);
      emit('alarms');
    }
  };

  const test = async (a) => {
    try {
      await api.post(`/alarms/${a.id}/test`);
      if (isAndroidApp) await scheduleTestAlarm(5, `Test: ${a.title}`);
      toast(isAndroidApp ? 'Test alarm will ring in 5 seconds' : phones.length ? 'Test sent — your phone will ring in a few seconds' : 'Test notification sent');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div>
      <PageHeader title="Alarms" subtitle="Rings on your phone — even offline" actions={<button className="btn-primary" onClick={() => setForm({})}><Plus size={16} /> Add alarm</button>} />

      {!isAndroidApp && !phones.length && (
        <Link to="/devices" className="mb-4 flex items-center gap-3 rounded-2xl border border-brand-100 bg-brand-50/60 p-4 text-sm dark:border-brand-500/20 dark:bg-brand-500/10">
          <Smartphone className="text-brand-500" />
          <span className="flex-1"><b>No phone connected.</b> Install the LifePilot Android app and sign in so alarms ring like a real alarm clock. Until then you’ll get browser notifications.</span>
        </Link>
      )}

      {loading && !alarms ? (
        <PageLoader />
      ) : alarms.length ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {alarms.map((a) => (
            <div key={a.id} className={`card p-4 transition ${a.enabled ? '' : 'opacity-60'}`}>
              <div className="flex items-start justify-between">
                <button onClick={() => setForm({ alarm: a })} className="text-left">
                  <p className="text-3xl font-extrabold tabular-nums">{a.alarm_time}</p>
                  <p className="font-semibold">{a.title}</p>
                  <p className="text-xs text-slate-500">{a.repeat_label}{a.status === 'completed' ? ' · finished' : ''}</p>
                </button>
                <Toggle checked={a.enabled} onChange={(on) => toggle(a, on)} label={`Toggle ${a.title}`} />
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-1.5 text-xs">
                {a.enabled && a.next_trigger_at && <span className="chip bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300"><AlarmClock size={12} /> {fmtDay(a.next_trigger_at)} {fmtTime(a.next_trigger_at)}</span>}
                <SyncBadge alarm={a} />
                {a.vibration && <Vibrate size={13} className="text-slate-400" />}
                {a.sound !== 'silent' && <Volume2 size={13} className="text-slate-400" />}
              </div>
              <div className="mt-3 flex gap-1 border-t border-slate-100 pt-2 dark:border-white/5">
                <button className="btn-ghost px-2 py-1.5 text-xs" onClick={() => setForm({ alarm: a })}><Pencil size={14} /> Edit</button>
                <button className="btn-ghost px-2 py-1.5 text-xs" onClick={() => test(a)}><FlaskConical size={14} /> Test</button>
                <button className="btn-ghost px-2 py-1.5 text-xs" onClick={() => setScheduleFor(a.id)}><CalendarClock size={14} /> Schedule</button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty icon={AlarmClock} title="No alarms yet" text="Create one here or say “Set an alarm every Monday, Wednesday and Friday at 6:30 AM for gym.”" action={<button className="btn-primary" onClick={() => setForm({})}><Plus size={16} /> Add alarm</button>} />
        </div>
      )}

      <AlarmForm open={!!form} alarm={form?.alarm} onClose={() => setForm(null)} />
      <ScheduleModal alarmId={scheduleFor} onClose={() => setScheduleFor(null)} />
    </div>
  );
}
