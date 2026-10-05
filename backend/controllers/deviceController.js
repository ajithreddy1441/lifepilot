const { one } = require('../config/db');
const deviceService = require('../services/devices/deviceService');
const alarmService = require('../services/alarms/alarmService');
const webPush = require('../services/notifications/webPushProvider');
const fcm = require('../services/notifications/fcmProvider');
const notifications = require('../services/notifications/notificationService');

const register = async (req, res) => res.status(201).json({ device: await deviceService.register(req.user.id, req.body) });
const list = async (req, res) => res.json({ devices: await deviceService.list(req.user.id) });
const sync = async (req, res) => res.json(await deviceService.sync(req.user.id, Number(req.params.id), req.body));
const alarmsFeed = async (req, res) => res.json(await alarmService.getSyncPayload(req.user.id));

async function remove(req, res) {
  await deviceService.remove(req.user.id, Number(req.params.id));
  res.json({ ok: true });
}

/** Server-side half of the "Test your setup" checklist; the client adds permission checks. */
async function diagnostics(req, res) {
  const userId = req.user.id;
  const [subs, android, synced] = await Promise.all([
    one('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?', [userId]),
    one("SELECT COUNT(*) AS n, MAX(last_sync_at) AS last_sync FROM devices WHERE user_id = ? AND platform = 'android' AND is_active = 1", [userId]),
    one(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN EXISTS (SELECT 1 FROM alarm_device_sync s JOIN devices d ON d.id = s.device_id WHERE s.alarm_id = a.id AND s.synced_version = a.version AND s.status = 'scheduled' AND d.is_active = 1) THEN 1 ELSE 0 END) AS synced FROM alarms a WHERE a.user_id = ? AND a.status = 'active' AND a.enabled = 1",
      [userId],
    ),
  ]);
  res.json({
    web_push_configured: webPush.isConfigured(),
    fcm_configured: fcm.isConfigured(),
    web_push_subscriptions: Number(subs.n),
    android_devices: Number(android.n),
    android_last_sync: android.last_sync,
    alarms_enabled: Number(synced.total || 0),
    alarms_synced: Number(synced.synced || 0),
  });
}

/** Ask every connected phone to ring a local test alarm (via SSE if the app is open, FCM otherwise). */
async function testAlarm(req, res) {
  await notifications.sendSyncSignal(req.user.id, 'test_alarm', { test_alarm_id: 'test' });
  res.json({ ok: true, fcm: fcm.isConfigured() });
}

module.exports = { register, list, remove, sync, alarmsFeed, diagnostics, testAlarm };
