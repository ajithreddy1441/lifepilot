import { useEffect, useState } from 'react';
import { Smartphone, Laptop, Trash2, FlaskConical, Bell, RefreshCw, ShieldCheck, AlertTriangle, CheckCircle2, Circle } from 'lucide-react';
import { api } from '../services/api';
import { emit } from '../services/bus';
import { useApi } from '../hooks/useApi';
import { useToast } from '../context/ToastContext';
import { PageHeader, PageLoader, Empty, Spinner } from '../components/ui';
import { fmtRelative } from '../utils/format';
import { getDeviceId } from '../utils/device';
import { isAndroidApp } from '../services/native/platform';
import { permissionStatus, requestNotificationPermission, openExactAlarmSettings, syncAlarms, scheduleTestAlarm } from '../services/native/alarmSync';
import { enablePush, permissionState, pushSupported, currentSubscription } from '../services/push';
import { DENIED_HELP } from '../features/notifications/PermissionBanner';

function Row({ ok, warn, label, detail, action }) {
  const Icon = ok ? CheckCircle2 : warn ? AlertTriangle : Circle;
  return (
    <li className="flex items-start gap-3 py-2.5">
      <Icon size={18} className={`mt-0.5 shrink-0 ${ok ? 'text-emerald-500' : warn ? 'text-amber-500' : 'text-slate-300'}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{label}</p>
        {detail && <p className="text-xs text-slate-500 dark:text-slate-400">{detail}</p>}
      </div>
      {action}
    </li>
  );
}

export default function Devices() {
  const toast = useToast();
  const { data: devices, loading, reload } = useApi(() => api.get('/devices').then((r) => r.devices), [], { topics: ['devices'], initial: [] });
  const { data: diag, reload: reloadDiag } = useApi(() => api.get('/devices/diagnostics'), [], { topics: ['devices', 'alarms'] });
  const [nativePerms, setNativePerms] = useState({ notifications: 'prompt', exactAlarm: 'prompt' });
  const [pushPerm, setPushPerm] = useState(permissionState());
  const [hasSub, setHasSub] = useState(false);
  const [busy, setBusy] = useState('');
  const thisId = getDeviceId();

  const refreshLocal = async () => {
    if (isAndroidApp) setNativePerms(await permissionStatus());
    setPushPerm(permissionState());
    setHasSub(!!(await currentSubscription()));
  };

  useEffect(() => { refreshLocal(); }, []);

  const remove = async (d) => {
    if (!confirm(`Disconnect "${d.device_name}"? Alarms will stop ringing on it.`)) return;
    await api.del(`/devices/${d.id}`);
    emit('devices');
    toast('Device disconnected');
  };

  const testNotif = async () => {
    setBusy('notif');
    try {
      await api.post('/notifications/test');
      toast('Test notification sent');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const testAlarm = async () => {
    setBusy('alarm');
    try {
      if (isAndroidApp) {
        await scheduleTestAlarm(5, 'Test alarm');
        toast('Phone alarm in 5 seconds — leave the app if you want to test background');
      } else {
        await api.post('/devices/test-alarm');
        toast(diag?.android_devices ? 'Your phone will ring in a few seconds if the app is open (or FCM is configured)' : 'No Android phone connected yet');
      }
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const syncNow = async () => {
    setBusy('sync');
    try {
      const r = await syncAlarms('manual');
      toast(r ? `Synced ${r.scheduled} alarms` : 'Open this page on the Android app to sync');
      emit('devices');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy('');
    }
  };

  const notifOk = isAndroidApp ? nativePerms.notifications === 'granted' : pushPerm === 'granted';
  const exactOk = !isAndroidApp || nativePerms.exactAlarm === 'granted';
  const pushOk = isAndroidApp ? !!diag?.fcm_configured && diag.android_devices > 0 : (pushPerm === 'granted' && (hasSub || diag?.web_push_subscriptions > 0));
  const deviceOk = isAndroidApp ? diag?.android_devices > 0 : devices.some((d) => d.platform === 'web');
  const channelOk = isAndroidApp; // channels are created at init; web uses the SW

  return (
    <div>
      <PageHeader
        title="Devices"
        subtitle="Where LifePilot can reach you"
        actions={
          <>
            {isAndroidApp && <button className="btn-secondary" onClick={syncNow} disabled={busy === 'sync'}>{busy === 'sync' ? <Spinner size={16} /> : <RefreshCw size={16} />} Sync alarms</button>}
            <button className="btn-secondary" onClick={testNotif} disabled={busy === 'notif'}>{busy === 'notif' ? <Spinner size={16} /> : <Bell size={16} />} Test notification</button>
            <button className="btn-primary" onClick={testAlarm} disabled={busy === 'alarm'}>{busy === 'alarm' ? <Spinner size={16} /> : <FlaskConical size={16} />} Test phone alarm</button>
          </>
        }
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="card p-5 lg:col-span-2">
          <p className="mb-2 font-extrabold">Connected devices</p>
          {loading && !devices.length ? (
            <PageLoader />
          ) : devices.length ? (
            <ul className="divide-y divide-slate-100 dark:divide-white/5">
              {devices.map((d) => {
                const mine = d.device_id === thisId || (isAndroidApp && d.platform === 'android');
                return (
                  <li key={d.id} className="flex items-center gap-3 py-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-300">
                      {d.platform === 'android' ? <Smartphone size={20} /> : <Laptop size={20} />}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold">{d.device_name} {mine && <span className="chip bg-brand-50 text-brand-600 dark:bg-brand-500/10">This device</span>}</p>
                      <p className="text-xs text-slate-500">
                        {d.platform} · seen {d.last_seen ? fmtRelative(d.last_seen) : 'never'}
                        {d.platform === 'android' && ` · ${d.alarms_synced || 0} alarms scheduled`}
                        {d.platform === 'web' && d.web_push_subscriptions > 0 && ' · web push on'}
                      </p>
                    </div>
                    <button onClick={() => remove(d)} className="rounded-lg p-2 text-slate-400 hover:text-rose-500" aria-label={`Disconnect ${d.device_name}`}><Trash2 size={16} /></button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <Empty icon={Smartphone} title="No devices registered" text="Sign in on this browser or the Android app and it will appear here automatically." />
          )}
        </div>

        <div className="card p-5">
          <p className="mb-1 flex items-center gap-2 font-extrabold"><ShieldCheck size={18} /> Test your setup</p>
          <p className="mb-2 text-xs text-slate-400">Each item must be green for alarms and reminders to work on this device.</p>
          <ul>
            <Row
              ok={notifOk}
              warn={pushPerm === 'denied' || nativePerms.notifications === 'denied'}
              label="Notification permission"
              detail={pushPerm === 'denied' ? DENIED_HELP : isAndroidApp ? `Status: ${nativePerms.notifications}` : `Browser: ${pushPerm}`}
              action={!notifOk && (
                <button
                  className="btn-secondary py-1 text-xs"
                  onClick={async () => {
                    if (isAndroidApp) await requestNotificationPermission();
                    else if (pushSupported()) {
                      const r = await enablePush();
                      if (r === 'denied') toast.error(DENIED_HELP);
                    }
                    await refreshLocal();
                    reloadDiag();
                  }}
                >
                  Allow
                </button>
              )}
            />
            <Row
              ok={pushOk}
              label="Push registration"
              detail={isAndroidApp ? (diag?.fcm_configured ? 'FCM configured — app can wake for instant sync' : 'FCM not configured. Alarms still fire if already synced; the app syncs on open.') : (diag?.web_push_configured ? `${diag.web_push_subscriptions} subscription(s)` : 'VAPID keys missing on the server')}
            />
            <Row ok={deviceOk} label="Device connected" detail={diag ? `${diag.android_devices} phone(s) · last phone sync ${diag.android_last_sync ? fmtRelative(diag.android_last_sync) : 'never'}` : 'Checking…'} />
            <Row
              ok={exactOk}
              warn={isAndroidApp && nativePerms.exactAlarm === 'denied'}
              label="Exact alarm permission"
              detail={isAndroidApp ? `Status: ${nativePerms.exactAlarm}` : 'Only needed on the Android app'}
              action={isAndroidApp && !exactOk && <button className="btn-secondary py-1 text-xs" onClick={async () => { await openExactAlarmSettings(); await refreshLocal(); }}>Fix</button>}
            />
            <Row ok={channelOk || !isAndroidApp} label="Notification channel" detail={isAndroidApp ? 'lifepilot_alarms + lifepilot_reminders' : 'Service worker handles display'} />
            <Row
              ok={diag && diag.alarms_enabled > 0 && diag.alarms_synced === diag.alarms_enabled}
              warn={diag && diag.alarms_enabled > 0 && diag.alarms_synced < diag.alarms_enabled}
              label="Alarms on phone"
              detail={diag ? `${diag.alarms_synced} / ${diag.alarms_enabled} enabled alarms scheduled on a phone` : ''}
            />
          </ul>
          <button className="btn-ghost mt-2 w-full text-xs" onClick={() => { refreshLocal(); reload(); reloadDiag(); }}>Refresh checklist</button>
        </div>
      </div>
    </div>
  );
}
