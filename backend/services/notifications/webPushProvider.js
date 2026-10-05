const webpush = require('web-push');
const env = require('../../config/env');

let configured = false;
if (env.vapid.publicKey && env.vapid.privateKey) {
  try {
    webpush.setVapidDetails(env.vapid.subject, env.vapid.publicKey, env.vapid.privateKey);
    configured = true;
  } catch (err) {
    console.warn('[webpush] invalid VAPID configuration:', err.message);
  }
}

const isConfigured = () => configured;

/** @returns {{ok: boolean, gone?: boolean, error?: string}} */
async function send(sub, payload, { urgency = 'normal', ttl = 3600 } = {}) {
  if (!configured) return { ok: false, error: 'VAPID keys not configured' };
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: ttl, urgency },
    );
    return { ok: true };
  } catch (err) {
    const gone = err.statusCode === 404 || err.statusCode === 410;
    return { ok: false, gone, error: `${err.statusCode || ''} ${err.body || err.message}`.trim().slice(0, 250) };
  }
}

module.exports = { isConfigured, send, publicKey: env.vapid.publicKey };
