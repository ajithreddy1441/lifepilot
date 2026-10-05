const { query, one } = require('../../config/db');
const { parseJson, toJson } = require('../../utils/json');
const { publish } = require('../../utils/events');
const { timeToMinutes, inZone } = require('../../utils/time');
const { getNotificationPreferences, getPreferences } = require('../../models/userModel');
const webPush = require('./webPushProvider');
const fcm = require('./fcmProvider');

// notification_type -> preference flag that must be on for delivery (alarms are always delivered).
const TYPE_PREF = {
  task_reminder: 'reminders',
  task_start: 'upcoming_tasks',
  reminder: 'reminders',
  deadline: 'deadlines',
  missed_task: 'missed_tasks',
  daily_briefing: 'daily_briefing',
  weekly_planning: 'weekly_planning',
  daily_review: 'daily_review',
};
const ALARM_TYPES = new Set(['alarm', 'alarm_reminder']);

function shape(n) {
  return n && { ...n, data: parseJson(n.data, {}), delivery: parseJson(n.delivery, null) };
}

/** Queue a notification for future delivery by the worker. Idempotent per (user, dedupe_key). */
async function schedule(userId, { type, title, message = null, scheduledAt, taskId = null, alarmId = null, dedupeKey = null, data = null, priority = 'normal' }) {
  await query(
    `INSERT INTO notifications (user_id, task_id, alarm_id, title, message, notification_type, priority, data, dedupe_key, scheduled_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
     ON DUPLICATE KEY UPDATE
       title = VALUES(title), message = VALUES(message), data = VALUES(data), scheduled_at = VALUES(scheduled_at),
       task_id = VALUES(task_id), alarm_id = VALUES(alarm_id), priority = VALUES(priority),
       status = IF(status IN ('cancelled', 'pending'), 'pending', status)`,
    [userId, taskId, alarmId, title.slice(0, 190), message && message.slice(0, 500), type, priority, toJson(data), dedupeKey, scheduledAt],
  );
}

/** Create and immediately deliver (in-app + push) a notification. */
async function notifyNow(userId, payload) {
  const res = await query(
    `INSERT INTO notifications (user_id, task_id, alarm_id, title, message, notification_type, priority, data, dedupe_key, scheduled_at, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), 'processing')
     ON DUPLICATE KEY UPDATE id = LAST_INSERT_ID(id)`,
    [userId, payload.taskId || null, payload.alarmId || null, payload.title.slice(0, 190), payload.message || null, payload.type, payload.priority || 'normal', toJson(payload.data), payload.dedupeKey || null],
  );
  const n = await one('SELECT * FROM notifications WHERE id = ?', [res.insertId]);
  if (n.status !== 'processing') return shape(n); // dedupe hit for an already-delivered notification
  return deliver(n);
}

async function cancelForAlarm(alarmId) {
  await query("UPDATE notifications SET status = 'cancelled' WHERE alarm_id = ? AND status = 'pending'", [alarmId]);
}

async function cancelForTask(taskId) {
  await query("UPDATE notifications SET status = 'cancelled' WHERE task_id = ? AND status = 'pending'", [taskId]);
}

function inQuietHours(prefs, tz) {
  if (!prefs.quiet_hours_start || !prefs.quiet_hours_end) return false;
  const now = inZone(new Date(), tz);
  const m = now.hour * 60 + now.minute;
  const s = timeToMinutes(prefs.quiet_hours_start);
  const e = timeToMinutes(prefs.quiet_hours_end);
  return s <= e ? m >= s && m < e : m >= s || m < e;
}

/** Fan a claimed notification out to web push, Android (FCM) and the in-app center. */
async function deliver(n) {
  const user = await one('SELECT id, timezone FROM users WHERE id = ?', [n.user_id]);
  const [nprefs, prefs] = await Promise.all([getNotificationPreferences(n.user_id), getPreferences(n.user_id)]);
  const isAlarm = ALARM_TYPES.has(n.notification_type);
  const prefKey = TYPE_PREF[n.notification_type];

  if (!isAlarm && prefKey && !nprefs[prefKey]) {
    await query("UPDATE notifications SET status = 'skipped', error = 'disabled in preferences', locked_by = NULL WHERE id = ?", [n.id]);
    return shape({ ...n, status: 'skipped' });
  }

  const data = parseJson(n.data, {});
  let target = prefs.notify_target;
  if (isAlarm && n.alarm_id) {
    const alarm = await one('SELECT notify_target, version FROM alarms WHERE id = ?', [n.alarm_id]);
    if (alarm) target = alarm.notify_target;
  }
  const quiet = !isAlarm && inQuietHours(nprefs, user.timezone);
  const delivery = { web: 0, android: 0, android_local: 0, errors: [] };

  const payload = {
    title: n.title,
    body: n.message || '',
    tag: n.dedupe_key || `n-${n.id}`,
    data: { ...data, notificationId: n.id, taskId: n.task_id, alarmId: n.alarm_id, type: n.notification_type, url: data.url || (n.task_id ? `/tasks?open=${n.task_id}` : '/notifications') },
    actions: n.task_id ? [{ action: 'complete', title: 'Complete' }, { action: 'snooze', title: 'Snooze 10 min' }] : [],
    requireInteraction: isAlarm || n.priority === 'high',
  };

  if (!quiet && nprefs.web_push && target !== 'phone') {
    const subs = await query('SELECT * FROM push_subscriptions WHERE user_id = ?', [n.user_id]);
    for (const sub of subs) {
      const r = await webPush.send(sub, payload, { urgency: isAlarm ? 'high' : 'normal' });
      if (r.ok) delivery.web += 1;
      else {
        delivery.errors.push(r.error);
        if (r.gone) await query('DELETE FROM push_subscriptions WHERE id = ?', [sub.id]);
      }
    }
  }

  if (!quiet && nprefs.mobile_push && target !== 'laptop') {
    const devices = await query("SELECT id, push_token FROM devices WHERE user_id = ? AND platform IN ('android','ios') AND is_active = 1", [n.user_id]);
    for (const d of devices) {
      // A phone that has this alarm scheduled natively rings on its own; a server push would duplicate it.
      if (isAlarm && n.alarm_id) {
        const synced = await one(
          "SELECT s.status FROM alarm_device_sync s JOIN alarms a ON a.id = s.alarm_id WHERE s.alarm_id = ? AND s.device_id = ? AND s.synced_version = a.version AND s.status = 'scheduled'",
          [n.alarm_id, d.id],
        );
        if (synced) {
          delivery.android_local += 1;
          continue;
        }
      }
      if (!d.push_token) continue;
      const r = await fcm.send(d.push_token, { title: payload.title, body: payload.body, data: payload.data, highPriority: isAlarm });
      if (r.ok) delivery.android += 1;
      else if (r.error !== 'FCM not configured') delivery.errors.push(r.error);
    }
  }

  delivery.errors = delivery.errors.slice(0, 5);
  await query(
    "UPDATE notifications SET status = 'sent', sent_at = UTC_TIMESTAMP(), delivery = ?, locked_by = NULL, attempts = attempts + 1 WHERE id = ?",
    [toJson(delivery), n.id],
  );
  const sent = shape(await one('SELECT * FROM notifications WHERE id = ?', [n.id]));
  if (nprefs.in_app) publish(n.user_id, 'notification', sent);
  return sent;
}

/** Wake Android devices so they pull the latest alarm state (data-only push), and refresh open websites. */
async function sendSyncSignal(userId, reason, extra = {}) {
  publish(userId, 'sync', { reason, ...extra });
  if (!fcm.isConfigured()) return;
  const devices = await query("SELECT push_token FROM devices WHERE user_id = ? AND platform = 'android' AND is_active = 1 AND push_token IS NOT NULL", [userId]);
  await Promise.all(devices.map((d) => fcm.send(d.push_token, { dataOnly: true, highPriority: true, data: { type: 'sync', reason, ...extra } })));
}

async function list(userId, { filter = 'all', limit = 50 } = {}) {
  let where = "user_id = ? AND status = 'sent'";
  if (filter === 'unread') where += ' AND read_at IS NULL';
  if (filter === 'reminders') where += " AND notification_type IN ('task_reminder','reminder','alarm_reminder','alarm','task_start')";
  if (filter === 'ai') where += " AND notification_type IN ('daily_briefing','weekly_planning','daily_review','ai')";
  const rows = await query(`SELECT * FROM notifications WHERE ${where} ORDER BY sent_at DESC LIMIT ?`, [userId, Math.min(Number(limit) || 50, 200)]);
  const unread = await one("SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND status = 'sent' AND read_at IS NULL", [userId]);
  return { notifications: rows.map(shape), unread: Number(unread.n) };
}

async function upcoming(userId, limit = 20) {
  const rows = await query(
    "SELECT * FROM notifications WHERE user_id = ? AND status = 'pending' AND scheduled_at >= UTC_TIMESTAMP() ORDER BY scheduled_at LIMIT ?",
    [userId, limit],
  );
  return rows.map(shape);
}

async function markRead(userId, id) {
  await query('UPDATE notifications SET read_at = COALESCE(read_at, UTC_TIMESTAMP()) WHERE id = ? AND user_id = ?', [id, userId]);
  publish(userId, 'notifications_read', { id });
}

async function markAllRead(userId) {
  await query("UPDATE notifications SET read_at = UTC_TIMESTAMP() WHERE user_id = ? AND status = 'sent' AND read_at IS NULL", [userId]);
  publish(userId, 'notifications_read', { all: true });
}

async function remove(userId, id) {
  const r = await query('DELETE FROM notifications WHERE id = ? AND user_id = ?', [id, userId]);
  return r.affectedRows > 0;
}

module.exports = { schedule, notifyNow, deliver, cancelForAlarm, cancelForTask, sendSyncSignal, list, upcoming, markRead, markAllRead, remove, shape };
