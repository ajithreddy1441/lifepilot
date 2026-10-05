const { query, one } = require('../config/db');

const STORY_RE = /\b(stor(y|ies)|akr|chapter|novel|write|writing|blog|poem)\b/i;

function utcDate(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

async function record(userId, eventType) {
  if (!userId) return;
  await query(
    'INSERT IGNORE INTO activity_events (user_id, event_type, event_date) VALUES (?, ?, ?)',
    [userId, eventType, utcDate()],
  );
}

/** Mark this user as an active reader for today (once per day). Throttles last_seen writes. */
async function touchSession(userId) {
  if (!userId) return;
  await query(
    'UPDATE users SET last_seen_at = UTC_TIMESTAMP() WHERE id = ? AND (last_seen_at IS NULL OR last_seen_at < UTC_TIMESTAMP() - INTERVAL 5 MINUTE)',
    [userId],
  );
  await record(userId, 'session');
}

function looksLikeStory(task) {
  if (!task) return false;
  if (task.category_slug === 'creative') return true;
  return STORY_RE.test(`${task.title || ''} ${task.description || ''} ${task.category_name || ''}`);
}

async function touchStoryFromTask(userId, task) {
  if (looksLikeStory(task)) await record(userId, 'story');
}

async function uniqueReaders(eventType, fromDate, toDate) {
  const row = await one(
    'SELECT COUNT(DISTINCT user_id) AS n FROM activity_events WHERE event_type = ? AND event_date >= ? AND event_date <= ?',
    [eventType, fromDate, toDate],
  );
  return Number(row?.n || 0);
}

async function series(eventType, days) {
  const rows = await query(
    `SELECT event_date AS date, COUNT(DISTINCT user_id) AS n
     FROM activity_events
     WHERE event_type = ? AND event_date >= UTC_DATE() - INTERVAL ? DAY
     GROUP BY event_date ORDER BY event_date`,
    [eventType, days - 1],
  );
  const map = Object.fromEntries(rows.map((r) => [String(r.date).slice(0, 10), Number(r.n)]));
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    out.push({ date: d, n: map[d] || 0 });
  }
  return out;
}

module.exports = { touchSession, touchStoryFromTask, looksLikeStory, uniqueReaders, series, utcDate, record };
