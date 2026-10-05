const { query, one } = require('../../config/db');
const { toJson, parseJson } = require('../../utils/json');
const { notFound } = require('../../utils/http');
const { publish } = require('../../utils/events');
const alarmService = require('../alarms/alarmService');

const shape = (d) => d && { ...d, capabilities: parseJson(d.capabilities, {}), is_active: !!d.is_active, push_token: undefined, has_push_token: !!d.push_token };

async function register(userId, data) {
  await query(
    `INSERT INTO devices (user_id, device_id, device_name, platform, push_token, timezone, app_version, capabilities, last_seen, is_active)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, UTC_TIMESTAMP(), 1)
     ON DUPLICATE KEY UPDATE device_name = VALUES(device_name), platform = VALUES(platform),
       push_token = COALESCE(VALUES(push_token), push_token), timezone = COALESCE(VALUES(timezone), timezone),
       app_version = COALESCE(VALUES(app_version), app_version), capabilities = COALESCE(VALUES(capabilities), capabilities),
       last_seen = UTC_TIMESTAMP(), is_active = 1`,
    [userId, data.device_id, data.device_name, data.platform, data.push_token || null, data.timezone || null, data.app_version || null, toJson(data.capabilities)],
  );
  const device = await one('SELECT * FROM devices WHERE user_id = ? AND device_id = ?', [userId, data.device_id]);
  publish(userId, 'devices_changed', { id: device.id });
  return shape(device);
}

async function list(userId) {
  const rows = await query(
    `SELECT d.*, (SELECT COUNT(*) FROM push_subscriptions p WHERE p.device_id = d.id) AS web_push_subscriptions,
       (SELECT COUNT(*) FROM alarm_device_sync s JOIN alarms a ON a.id = s.alarm_id WHERE s.device_id = d.id AND s.status = 'scheduled' AND s.synced_version = a.version AND a.status = 'active') AS alarms_synced
     FROM devices d WHERE d.user_id = ? AND d.is_active = 1 ORDER BY d.last_seen DESC`,
    [userId],
  );
  return rows.map(shape);
}

async function getOwned(userId, id) {
  const d = await one('SELECT * FROM devices WHERE id = ? AND user_id = ?', [id, userId]);
  if (!d) throw notFound('Device');
  return d;
}

async function remove(userId, id) {
  await getOwned(userId, id);
  await query('DELETE FROM push_subscriptions WHERE device_id = ?', [id]);
  await query('UPDATE devices SET is_active = 0, push_token = NULL WHERE id = ?', [id]);
  publish(userId, 'devices_changed', { id });
}

/**
 * Two-way reconcile. The device reports what it scheduled (results) and what it holds locally;
 * the server returns the authoritative alarm set. Server state wins; ids keep local alarms unique.
 */
async function sync(userId, id, body) {
  const device = await getOwned(userId, id);
  if (body.results?.length) await alarmService.recordSyncResults(device.id, body.results);
  await query(
    'UPDATE devices SET last_seen = UTC_TIMESTAMP(), last_sync_at = UTC_TIMESTAMP(), capabilities = COALESCE(?, capabilities), timezone = COALESCE(?, timezone) WHERE id = ?',
    [toJson(body.capabilities), body.timezone || null, device.id],
  );
  const payload = await alarmService.getSyncPayload(userId);
  const serverVersions = new Map(payload.alarms.map((a) => [a.id, a.version]));
  const local = body.local_alarms || [];
  const stale = local.filter((l) => serverVersions.has(l.id) && serverVersions.get(l.id) !== l.version).map((l) => l.id);
  const orphaned = local.filter((l) => !serverVersions.has(l.id)).map((l) => l.id);
  if (body.results?.length) publish(userId, 'alarms_changed', { reason: 'device_synced', device_id: device.id });
  return { ...payload, device_id: device.id, diff: { stale, orphaned } };
}

module.exports = { register, list, remove, sync, getOwned };
