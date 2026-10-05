const { query, one } = require('../../config/db');
const { HttpError, notFound } = require('../../utils/http');
const { normTime, parseDays, formatDays, inZone, DateTime, humanTime, humanDate } = require('../../utils/time');
const { getPreferences, getUser } = require('../../models/userModel');
const { publish } = require('../../utils/events');
const notifications = require('../notifications/notificationService');
const { nextOccurrence, upcomingOccurrences, describeRepeat } = require('./recurrence');

const FIELDS = [
  'title', 'description', 'task_id', 'category_id', 'alarm_date', 'alarm_time', 'timezone', 'duration_minutes', 'repeat_type',
  'repeat_days', 'repeat_interval_days', 'repeat_until', 'sound', 'vibration', 'reminder_minutes', 'snooze_minutes', 'priority',
  'notify_target', 'enabled',
];

function shape(a) {
  if (!a) return null;
  return {
    ...a,
    alarm_time: normTime(a.alarm_time),
    repeat_days: parseDays(a.repeat_days),
    vibration: !!a.vibration,
    enabled: !!a.enabled,
    repeat_label: describeRepeat(a),
  };
}

async function attachSyncStatus(userId, alarms) {
  if (!alarms.length) return alarms;
  const rows = await query(
    `SELECT s.alarm_id, s.synced_version, s.status, s.synced_at, s.error, d.id AS device_id, d.device_name, d.platform
     FROM alarm_device_sync s JOIN devices d ON d.id = s.device_id
     WHERE d.user_id = ? AND s.alarm_id IN (?)`,
    [userId, alarms.map((a) => a.id)],
  );
  return alarms.map((a) => ({
    ...a,
    sync: rows
      .filter((r) => r.alarm_id === a.id)
      .map((r) => ({ ...r, up_to_date: r.synced_version === a.version })),
  }));
}

async function list(userId) {
  const rows = await query(
    "SELECT * FROM alarms WHERE user_id = ? AND status <> 'deleted' ORDER BY enabled DESC, alarm_time, id",
    [userId],
  );
  return attachSyncStatus(userId, rows.map(shape));
}

async function get(userId, id) {
  const a = shape(await one("SELECT * FROM alarms WHERE id = ? AND user_id = ? AND status <> 'deleted'", [id, userId]));
  if (!a) throw notFound('Alarm');
  const [withSync] = await attachSyncStatus(userId, [a]);
  withSync.upcoming = a.enabled ? upcomingOccurrences(a, 6) : [];
  return withSync;
}

function normalize(data, defaults) {
  const a = { ...defaults, ...data };
  a.alarm_time = normTime(a.alarm_time);
  if (a.repeat_type === 'weekly' && !parseDays(a.repeat_days).length) {
    a.repeat_days = [DateTime.fromISO(a.alarm_date).toFormat('ccc').toUpperCase()];
  }
  if (a.repeat_type === 'daily' || a.repeat_type === 'once' || a.repeat_type === 'custom') {
    if (a.repeat_type !== 'custom') a.repeat_interval_days = null;
    if (a.repeat_type !== 'weekly' && a.repeat_type !== 'selected_days') a.repeat_days = null;
  }
  a.repeat_days = a.repeat_days ? formatDays(a.repeat_days) : null;
  return a;
}

/** (Re)queue the reminder + ring notifications for the next occurrence. Cancels anything stale first. */
async function scheduleJobs(alarm) {
  await notifications.cancelForAlarm(alarm.id);
  const next = alarm.enabled && alarm.status === 'active' ? nextOccurrence(alarm) : null;
  await query('UPDATE alarms SET next_trigger_at = ? WHERE id = ?', [next, alarm.id]);
  if (!next) return null;

  const tz = alarm.timezone;
  const endLabel = alarm.duration_minutes ? ` – ${humanTime(new Date(next.getTime() + alarm.duration_minutes * 60000), tz)}` : '';
  await notifications.schedule(alarm.user_id, {
    type: 'alarm',
    title: `⏰ ${alarm.title}`,
    message: alarm.description || `It's time: ${humanTime(next, tz)}${endLabel}`,
    scheduledAt: next,
    alarmId: alarm.id,
    taskId: alarm.task_id,
    priority: 'high',
    dedupeKey: `alarm:${alarm.id}:${next.toISOString()}`,
    data: { url: `/alarms?open=${alarm.id}`, snooze_minutes: alarm.snooze_minutes },
  });

  const remind = Number(alarm.reminder_minutes) || 0;
  const remindAt = new Date(next.getTime() - remind * 60000);
  if (remind > 0 && remindAt > new Date()) {
    await notifications.schedule(alarm.user_id, {
      type: 'alarm_reminder',
      title: `🔔 ${alarm.title} in ${remind} minutes`,
      message: `${humanDate(next, tz)} at ${humanTime(next, tz)}`,
      scheduledAt: remindAt,
      alarmId: alarm.id,
      taskId: alarm.task_id,
      dedupeKey: `alarm-rem:${alarm.id}:${next.toISOString()}`,
      data: { url: `/alarms?open=${alarm.id}` },
    });
  }
  return next;
}

async function changed(userId, alarmId, reason) {
  publish(userId, 'alarms_changed', { alarmId, reason });
  await notifications.sendSyncSignal(userId, reason, { alarm_id: String(alarmId) });
}

async function create(userId, data) {
  const [user, prefs] = await Promise.all([getUser(userId), getPreferences(userId)]);
  const a = normalize(data, {
    timezone: user.timezone,
    sound: prefs.default_alarm_sound,
    vibration: prefs.default_vibration,
    snooze_minutes: prefs.default_snooze_minutes,
    reminder_minutes: prefs.default_reminder_minutes,
    notify_target: prefs.notify_target,
    priority: 'medium',
    enabled: true,
    repeat_type: 'once',
  });
  if (a.repeat_type === 'once' && !nextOccurrence(a)) {
    throw new HttpError(422, `That time (${a.alarm_date} ${a.alarm_time}) has already passed in ${a.timezone}`);
  }
  if (a.task_id) {
    const task = await one('SELECT id FROM tasks WHERE id = ? AND user_id = ?', [a.task_id, userId]);
    if (!task) throw notFound('Task');
  }
  const cols = FIELDS.filter((f) => a[f] !== undefined);
  const res = await query(
    `INSERT INTO alarms (user_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
    [userId, ...cols.map((c) => (typeof a[c] === 'boolean' ? Number(a[c]) : a[c]))],
  );
  const alarm = await one('SELECT * FROM alarms WHERE id = ?', [res.insertId]);
  await scheduleJobs(alarm);
  await changed(userId, alarm.id, 'alarm_created');
  return get(userId, alarm.id);
}

async function update(userId, id, patch) {
  const current = await one("SELECT * FROM alarms WHERE id = ? AND user_id = ? AND status <> 'deleted'", [id, userId]);
  if (!current) throw notFound('Alarm');
  if (patch.version !== undefined && Number(patch.version) !== current.version) {
    throw new HttpError(409, 'This alarm was changed on another device. Reload to see the latest version.', { current: shape(current) });
  }
  const merged = normalize(
    { ...Object.fromEntries(Object.entries(patch).filter(([k, v]) => FIELDS.includes(k) && v !== undefined)) },
    { ...current, repeat_days: parseDays(current.repeat_days) },
  );
  if (merged.enabled && merged.repeat_type === 'once' && !nextOccurrence(merged) && (patch.alarm_date || patch.alarm_time)) {
    throw new HttpError(422, 'That time has already passed');
  }
  const cols = FIELDS.filter((f) => merged[f] !== undefined);
  await query(
    `UPDATE alarms SET ${cols.map((c) => `${c} = ?`).join(', ')}, status = 'active', version = version + 1 WHERE id = ?`,
    [...cols.map((c) => (typeof merged[c] === 'boolean' ? Number(merged[c]) : merged[c])), id],
  );
  const alarm = await one('SELECT * FROM alarms WHERE id = ?', [id]);
  await scheduleJobs(alarm);
  await changed(userId, id, 'alarm_updated');
  return get(userId, id);
}

const setEnabled = (userId, id, enabled) => update(userId, id, { enabled });

async function remove(userId, id) {
  const current = await one("SELECT id FROM alarms WHERE id = ? AND user_id = ? AND status <> 'deleted'", [id, userId]);
  if (!current) throw notFound('Alarm');
  // Soft delete keeps a tombstone so offline phones learn to cancel their local copy on next sync.
  await query("UPDATE alarms SET status = 'deleted', enabled = 0, deleted_at = UTC_TIMESTAMP(), next_trigger_at = NULL, version = version + 1 WHERE id = ?", [id]);
  await notifications.cancelForAlarm(id);
  await query('UPDATE habits SET alarm_id = NULL WHERE alarm_id = ?', [id]);
  await changed(userId, id, 'alarm_deleted');
  return true;
}

/** Called by the worker after an occurrence fires: queue the next one or retire a one-time alarm. */
async function advance(alarmId) {
  const alarm = await one("SELECT * FROM alarms WHERE id = ? AND status = 'active'", [alarmId]);
  if (!alarm) return;
  if (alarm.repeat_type === 'once') {
    if (!nextOccurrence(alarm)) await query("UPDATE alarms SET status = 'completed', next_trigger_at = NULL WHERE id = ?", [alarmId]);
    return;
  }
  await scheduleJobs(alarm);
}

async function snooze(userId, id, minutes) {
  const alarm = await one("SELECT * FROM alarms WHERE id = ? AND user_id = ? AND status <> 'deleted'", [id, userId]);
  if (!alarm) throw notFound('Alarm');
  const mins = Number(minutes) || alarm.snooze_minutes || 10;
  const at = new Date(Date.now() + mins * 60000);
  await notifications.schedule(userId, {
    type: 'alarm',
    title: `⏰ ${alarm.title} (snoozed)`,
    message: `Snoozed for ${mins} minutes`,
    scheduledAt: at,
    alarmId: alarm.id,
    taskId: alarm.task_id,
    priority: 'high',
    dedupeKey: `alarm-snooze:${alarm.id}:${at.getTime()}`,
  });
  return { snoozed_until: at };
}

async function test(userId, id) {
  const alarm = await one("SELECT * FROM alarms WHERE id = ? AND user_id = ? AND status <> 'deleted'", [id, userId]);
  if (!alarm) throw notFound('Alarm');
  const sent = await notifications.notifyNow(userId, {
    type: 'alarm',
    title: `🧪 Test: ${alarm.title}`,
    message: 'This is how your alarm notification will look.',
    alarmId: null,
    taskId: alarm.task_id,
    priority: 'high',
    data: { test: true, url: `/alarms?open=${alarm.id}` },
  });
  await notifications.sendSyncSignal(userId, 'test_alarm', { test_alarm_id: String(alarm.id) });
  return sent;
}

/** Full desired state for a device. The phone reconciles against this (server wins, keyed by alarm id). */
async function getSyncPayload(userId) {
  const active = await query("SELECT * FROM alarms WHERE user_id = ? AND status = 'active' ORDER BY id", [userId]);
  const tombstones = await query(
    "SELECT id, version FROM alarms WHERE user_id = ? AND status IN ('deleted','completed') AND updated_at > UTC_TIMESTAMP() - INTERVAL 60 DAY",
    [userId],
  );
  return {
    server_time: new Date().toISOString(),
    alarms: active.map((a) => {
      const s = shape(a);
      return { ...s, upcoming: s.enabled ? upcomingOccurrences(s, 14) : [] };
    }),
    removed: tombstones.map((t) => ({ id: t.id, version: t.version })),
  };
}

async function recordSyncResults(deviceDbId, results) {
  for (const r of results) {
    await query(
      `INSERT INTO alarm_device_sync (alarm_id, device_id, synced_version, status, error) VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE synced_version = VALUES(synced_version), status = VALUES(status), error = VALUES(error), synced_at = UTC_TIMESTAMP()`,
      [r.alarm_id, deviceDbId, r.version, r.status, r.error || null],
    ).catch((err) => {
      if (err.code !== 'ER_NO_REFERENCED_ROW_2') throw err; // alarm hard-deleted meanwhile
    });
  }
}

/** Keep a task's linked alarm in step with the task (create/move/remove). */
async function syncTaskAlarm(userId, task) {
  const existing = await one("SELECT * FROM alarms WHERE task_id = ? AND user_id = ? AND status = 'active'", [task.id, userId]);
  const wants = task.alarm_enabled && task.start_at && !['completed', 'cancelled'].includes(task.status) && new Date(task.start_at) > new Date();
  if (!wants) {
    if (existing) await remove(userId, existing.id);
    return null;
  }
  const user = await getUser(userId);
  const start = inZone(task.start_at, user.timezone);
  const fields = {
    title: task.title,
    alarm_date: start.toISODate(),
    alarm_time: start.toFormat('HH:mm'),
    timezone: user.timezone,
    duration_minutes: task.duration_minutes,
    priority: task.priority,
    category_id: task.category_id,
    reminder_minutes: task.reminder_minutes ?? undefined,
    task_id: task.id,
  };
  if (!existing) return create(userId, { ...fields, repeat_type: 'once' });
  const same = existing.alarm_date === fields.alarm_date && normTime(existing.alarm_time) === fields.alarm_time && existing.title === fields.title
    && existing.reminder_minutes === (fields.reminder_minutes ?? existing.reminder_minutes);
  return same ? shape(existing) : update(userId, existing.id, fields);
}

module.exports = { list, get, create, update, remove, setEnabled, advance, snooze, test, scheduleJobs, getSyncPayload, recordSyncResults, syncTaskAlarm, shape };
