const fs = require('fs');
const env = require('../../config/env');

// Firebase Cloud Messaging is optional. It wakes the Android app to re-sync alarms and delivers
// server-side pushes; alarms already synced to the phone fire locally without it.
let messaging = null;
let initError = null;

function init() {
  if (messaging || initError || !env.fcmServiceAccount) return;
  try {
    // eslint-disable-next-line global-require
    const admin = require('firebase-admin');
    const raw = env.fcmServiceAccount.trim().startsWith('{')
      ? env.fcmServiceAccount
      : fs.readFileSync(env.fcmServiceAccount, 'utf8');
    const app = admin.apps.length ? admin.app() : admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)) });
    messaging = app.messaging();
  } catch (err) {
    initError = err.message;
    console.warn('[fcm] disabled:', err.message);
  }
}

const isConfigured = () => {
  init();
  return !!messaging;
};

const stringifyData = (data = {}) => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));

async function send(token, { title, body, data, highPriority = false, dataOnly = false }) {
  if (!isConfigured()) return { ok: false, error: initError || 'FCM not configured' };
  const message = {
    token,
    data: stringifyData(data),
    android: { priority: highPriority ? 'high' : 'normal' },
  };
  if (!dataOnly) {
    message.notification = { title, body };
    message.android.notification = { channelId: highPriority ? 'lifepilot_alarms' : 'lifepilot_reminders' };
  }
  try {
    await messaging.send(message);
    return { ok: true };
  } catch (err) {
    const gone = /registration-token-not-registered|invalid-argument/.test(err.code || '');
    return { ok: false, gone, error: (err.code || err.message).slice(0, 250) };
  }
}

module.exports = { isConfigured, send };
