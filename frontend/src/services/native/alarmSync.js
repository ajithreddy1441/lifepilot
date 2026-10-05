// Android alarm synchronisation. The server is the source of truth; this module mirrors its alarm set
// into native exact-time local notifications so they fire with the website closed and the phone offline.
import { LocalNotifications } from '@capacitor/local-notifications';
import { Preferences } from '@capacitor/preferences';
import { api } from '../api';
import { emit } from '../bus';
import { isAndroidApp } from './platform';

const STATE_KEY = 'lp_alarm_state_v1';
const DEVICE_KEY = 'lp_device_db_id';
const ALARM_CHANNEL = 'lifepilot_alarms';
const REMINDER_CHANNEL = 'lifepilot_reminders';
const SNOOZE_SLOT = 99;
const MAX_SCHEDULED = 400; // Android caps an app at 500 pending alarms

// Stable notification ids derived from the server alarm id: rescheduling replaces, never duplicates.
const ringId = (alarmId, i) => alarmId * 100 + i; // slots 0..48
const reminderId = (alarmId, i) => alarmId * 100 + 50 + i; // slots 50..98

let syncing = null;
let initialised = false;

async function loadState() {
  const { value } = await Preferences.get({ key: STATE_KEY });
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}
const saveState = (s) => Preferences.set({ key: STATE_KEY, value: JSON.stringify(s) });

export async function getDeviceDbId() {
  const { value } = await Preferences.get({ key: DEVICE_KEY });
  return value ? Number(value) : null;
}
export const setDeviceDbId = (id) => Preferences.set({ key: DEVICE_KEY, value: String(id) });

export async function ensureChannels() {
  await LocalNotifications.createChannel({
    id: ALARM_CHANNEL,
    name: 'Alarms',
    description: 'Ringing alarms for tasks and routines',
    importance: 5,
    visibility: 1,
    vibration: true,
    lights: true,
    lightColor: '#6366F1',
  });
  await LocalNotifications.createChannel({
    id: REMINDER_CHANNEL,
    name: 'Reminders',
    description: 'Heads-up reminders before tasks start',
    importance: 4,
    visibility: 1,
    vibration: true,
  });
  await LocalNotifications.registerActionTypes({
    types: [
      {
        id: 'ALARM',
        actions: [
          { id: 'start', title: 'Start', foreground: true },
          { id: 'snooze', title: 'Snooze 10 min' },
          { id: 'complete', title: 'Complete' },
          { id: 'reschedule', title: 'Reschedule', foreground: true },
        ],
      },
      {
        id: 'REMINDER',
        actions: [
          { id: 'open', title: 'Open', foreground: true },
          { id: 'snooze', title: 'Snooze 10 min' },
          { id: 'complete', title: 'Complete' },
        ],
      },
    ],
  });
}

export async function permissionStatus() {
  if (!isAndroidApp) return { notifications: 'unsupported', exactAlarm: 'unsupported' };
  const p = await LocalNotifications.checkPermissions();
  let exact = 'granted';
  try {
    const e = await LocalNotifications.checkExactNotificationSetting();
    exact = e.exact_alarm;
  } catch {
    /* Android < 12 has no exact alarm permission */
  }
  return { notifications: p.display, exactAlarm: exact };
}

export async function requestNotificationPermission() {
  const p = await LocalNotifications.requestPermissions();
  return p.display;
}

export async function openExactAlarmSettings() {
  const r = await LocalNotifications.changeExactNotificationSetting();
  return r.exact_alarm;
}

function idsFor(alarmId) {
  return Array.from({ length: 99 }, (_, i) => ({ id: alarmId * 100 + i })).concat({ id: ringId(alarmId, SNOOZE_SLOT) });
}

async function cancelAlarm(alarmId) {
  await LocalNotifications.cancel({ notifications: idsFor(alarmId) });
}

function buildNotifications(alarm, perAlarm) {
  const silent = alarm.sound === 'silent';
  const out = [];
  const now = Date.now();
  const occurrences = (alarm.upcoming || []).map((d) => new Date(d)).filter((d) => d.getTime() > now).slice(0, perAlarm);
  const timeLabel = (d) => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  occurrences.forEach((at, i) => {
    const end = alarm.duration_minutes ? new Date(at.getTime() + alarm.duration_minutes * 60000) : null;
    const extra = { alarmId: alarm.id, taskId: alarm.task_id, version: alarm.version, title: alarm.title, snooze: alarm.snooze_minutes };
    out.push({
      id: ringId(alarm.id, i),
      title: `⏰ ${alarm.title.toUpperCase()}`,
      body: alarm.description || `It's time${end ? ` · ${timeLabel(at)} – ${timeLabel(end)}` : ''}`,
      schedule: { at, allowWhileIdle: true },
      channelId: silent ? REMINDER_CHANNEL : ALARM_CHANNEL,
      actionTypeId: 'ALARM',
      ongoing: !silent,
      autoCancel: true,
      smallIcon: 'ic_stat_lifepilot',
      extra,
    });
    const before = Number(alarm.reminder_minutes) || 0;
    const remindAt = new Date(at.getTime() - before * 60000);
    if (before > 0 && remindAt.getTime() > now) {
      out.push({
        id: reminderId(alarm.id, i),
        title: `🔔 ${alarm.title} in ${before} minutes`,
        body: `Starts at ${timeLabel(at)}`,
        schedule: { at: remindAt, allowWhileIdle: true },
        channelId: REMINDER_CHANNEL,
        actionTypeId: 'REMINDER',
        smallIcon: 'ic_stat_lifepilot',
        extra,
      });
    }
  });
  return out;
}

/**
 * Pull the authoritative alarm set and reconcile local schedules.
 * Conflict rule: the server version always wins; local entries are keyed by alarm id + version.
 */
export async function syncAlarms(reason = 'manual') {
  if (!isAndroidApp) return null;
  if (syncing) return syncing;
  syncing = (async () => {
    const deviceId = await getDeviceDbId();
    if (!deviceId) return null;
    const state = await loadState();
    const perms = await permissionStatus();
    const local = Object.entries(state).map(([id, s]) => ({ id: Number(id), version: s.version }));
    const payload = await api.post(`/devices/${deviceId}/sync`, {
      local_alarms: local,
      capabilities: { notification_permission: perms.notifications, exact_alarm: perms.exactAlarm, channels: true, reason },
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });

    const results = [];
    const serverIds = new Set();
    const enabled = payload.alarms.filter((a) => a.enabled);
    const perAlarm = Math.max(2, Math.min(14, Math.floor(MAX_SCHEDULED / Math.max(1, enabled.length * 2))));

    for (const alarm of payload.alarms) {
      serverIds.add(alarm.id);
      const prev = state[alarm.id];
      if (!alarm.enabled) {
        if (prev) {
          await cancelAlarm(alarm.id);
          delete state[alarm.id];
        }
        results.push({ alarm_id: alarm.id, version: alarm.version, status: 'cancelled' });
        continue;
      }
      const lastScheduled = prev?.last ? new Date(prev.last).getTime() : 0;
      const needsTopUp = prev && prev.count > 1 && lastScheduled - Date.now() < 3 * 86400000;
      if (prev && prev.version === alarm.version && !needsTopUp) continue;
      try {
        await cancelAlarm(alarm.id);
        const notifications = buildNotifications(alarm, perAlarm);
        if (notifications.length) await LocalNotifications.schedule({ notifications });
        const rings = notifications.filter((n) => n.actionTypeId === 'ALARM');
        state[alarm.id] = { version: alarm.version, count: rings.length, last: rings.length ? rings[rings.length - 1].schedule.at.toISOString() : null };
        results.push({ alarm_id: alarm.id, version: alarm.version, status: 'scheduled' });
      } catch (err) {
        results.push({ alarm_id: alarm.id, version: alarm.version, status: 'failed', error: String(err.message || err).slice(0, 200) });
      }
    }

    // Anything we hold locally that the server no longer lists (deleted/completed) gets cancelled.
    for (const id of Object.keys(state).map(Number)) {
      if (!serverIds.has(id)) {
        await cancelAlarm(id);
        const removed = payload.removed.find((r) => r.id === id);
        delete state[id];
        if (removed) results.push({ alarm_id: id, version: removed.version, status: 'cancelled' });
      }
    }
    await saveState(state);
    if (results.length) {
      await api.post(`/devices/${deviceId}/sync`, { local_alarms: Object.entries(state).map(([id, s]) => ({ id: Number(id), version: s.version })), results });
    }
    localStorage.setItem('lp_last_alarm_sync', new Date().toISOString());
    emit('alarms', { source: 'native-sync' });
    return { scheduled: Object.keys(state).length, changed: results.length };
  })().finally(() => {
    syncing = null;
  });
  return syncing;
}

export async function scheduleTestAlarm(seconds = 5, title = 'Test alarm') {
  await LocalNotifications.schedule({
    notifications: [{
      id: 2_000_000_000 + Math.floor(Math.random() * 1000),
      title: `⏰ ${title.toUpperCase()}`,
      body: 'If you can see and hear this, phone alarms are working.',
      schedule: { at: new Date(Date.now() + seconds * 1000), allowWhileIdle: true },
      channelId: ALARM_CHANNEL,
      actionTypeId: 'ALARM',
      smallIcon: 'ic_stat_lifepilot',
      extra: { test: true },
    }],
  });
}

async function snooze(extra) {
  const minutes = Number(extra.snooze) || 10;
  await LocalNotifications.schedule({
    notifications: [{
      id: ringId(extra.alarmId || 0, SNOOZE_SLOT),
      title: `⏰ ${String(extra.title || 'Alarm').toUpperCase()} (snoozed)`,
      body: `Snoozed for ${minutes} minutes`,
      schedule: { at: new Date(Date.now() + minutes * 60000), allowWhileIdle: true },
      channelId: ALARM_CHANNEL,
      actionTypeId: 'ALARM',
      smallIcon: 'ic_stat_lifepilot',
      extra,
    }],
  });
}

/** Wire native notification actions once per app launch. navigate: (path) => void */
export async function initNativeAlarms(navigate) {
  if (!isAndroidApp || initialised) return;
  initialised = true;
  await ensureChannels();
  await LocalNotifications.addListener('localNotificationActionPerformed', async ({ actionId, notification }) => {
    const extra = notification.extra || {};
    try {
      if (actionId === 'snooze') await snooze(extra);
      else if (actionId === 'complete' && extra.taskId) await api.post(`/tasks/${extra.taskId}/complete`);
      else if (actionId === 'start' && extra.taskId) {
        await api.put(`/tasks/${extra.taskId}`, { status: 'in_progress' });
        navigate('/today');
      } else if (actionId === 'reschedule') navigate(extra.taskId ? `/tasks?open=${extra.taskId}&reschedule=1` : `/alarms?open=${extra.alarmId}`);
      else if (actionId === 'tap' || actionId === 'open') navigate(extra.taskId ? `/tasks?open=${extra.taskId}` : extra.alarmId ? `/alarms?open=${extra.alarmId}` : '/');
    } catch (err) {
      console.warn('Alarm action failed', err);
    }
  });
}
