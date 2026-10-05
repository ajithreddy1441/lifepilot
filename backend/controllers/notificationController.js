const { query } = require('../config/db');
const notificationService = require('../services/notifications/notificationService');
const deviceService = require('../services/devices/deviceService');
const webPush = require('../services/notifications/webPushProvider');
const { getNotificationPreferences } = require('../models/userModel');
const { HttpError } = require('../utils/http');

const list = async (req, res) => res.json(await notificationService.list(req.user.id, { filter: req.query.filter, limit: req.query.limit }));
const upcoming = async (req, res) => res.json({ notifications: await notificationService.upcoming(req.user.id) });
const vapidKey = (_req, res) => res.json({ publicKey: webPush.publicKey || null, configured: webPush.isConfigured() });

async function subscribe(req, res) {
  if (!webPush.isConfigured()) throw new HttpError(503, 'Web push is not configured on the server (missing VAPID keys)');
  const { subscription, device_id: deviceId, device_name: deviceName } = req.body;
  let deviceDbId = null;
  if (deviceId) {
    const device = await deviceService.register(req.user.id, { device_id: deviceId, device_name: deviceName || 'Browser', platform: 'web', timezone: req.user.timezone });
    deviceDbId = device.id;
  }
  await query(
    `INSERT INTO push_subscriptions (user_id, device_id, endpoint, p256dh, auth, platform, user_agent) VALUES (?, ?, ?, ?, ?, 'web', ?)
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), device_id = VALUES(device_id), p256dh = VALUES(p256dh), auth = VALUES(auth), user_agent = VALUES(user_agent)`,
    [req.user.id, deviceDbId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, String(req.headers['user-agent'] || '').slice(0, 255)],
  );
  res.status(201).json({ ok: true });
}

async function unsubscribe(req, res) {
  if (req.body?.endpoint) await query('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?', [req.body.endpoint, req.user.id]);
  res.json({ ok: true });
}

async function read(req, res) {
  await notificationService.markRead(req.user.id, Number(req.params.id));
  res.json({ ok: true });
}

async function readAll(req, res) {
  await notificationService.markAllRead(req.user.id);
  res.json({ ok: true });
}

async function remove(req, res) {
  await notificationService.remove(req.user.id, Number(req.params.id));
  res.json({ ok: true });
}

async function test(req, res) {
  const n = await notificationService.notifyNow(req.user.id, {
    type: 'reminder',
    title: '🔔 Test notification',
    message: 'Notifications are working on this device.',
    data: { url: '/notifications', test: true },
  });
  res.json({ notification: n });
}

const getPreferences = async (req, res) => res.json({ preferences: await getNotificationPreferences(req.user.id) });

async function updatePreferences(req, res) {
  const cols = Object.keys(req.body);
  if (cols.length) {
    await query(
      `UPDATE notification_preferences SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE user_id = ?`,
      [...cols.map((c) => (typeof req.body[c] === 'boolean' ? Number(req.body[c]) : req.body[c])), req.user.id],
    );
  }
  res.json({ preferences: await getNotificationPreferences(req.user.id) });
}

module.exports = { list, upcoming, vapidKey, subscribe, unsubscribe, read, readAll, remove, test, getPreferences, updatePreferences };
