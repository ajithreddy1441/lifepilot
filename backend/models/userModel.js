const { query, one } = require('../config/db');
const { normTime, parseDays } = require('../utils/time');

const DEFAULT_CATEGORIES = [
  { slug: 'job', name: 'Job', icon: '💼', color: '#3b82f6' },
  { slug: 'freelancing', name: 'Freelancing', icon: '💻', color: '#8b5cf6' },
  { slug: 'personal', name: 'Personal', icon: '❤️', color: '#ec4899' },
  { slug: 'fitness', name: 'Fitness', icon: '🏃', color: '#22c55e' },
  { slug: 'creative', name: 'Creative', icon: '✍️', color: '#f59e0b' },
  { slug: 'learning', name: 'Learning', icon: '📚', color: '#06b6d4' },
  { slug: 'home', name: 'Home', icon: '🏠', color: '#f97316' },
  { slug: 'goals', name: 'Goals', icon: '🎯', color: '#ef4444' },
];

const slugify = (s) =>
  String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'category';

async function ensureUserDefaults(userId) {
  await query('INSERT IGNORE INTO user_preferences (user_id) VALUES (?)', [userId]);
  await query('INSERT IGNORE INTO notification_preferences (user_id) VALUES (?)', [userId]);
  const existing = await one('SELECT COUNT(*) AS n FROM categories WHERE user_id = ?', [userId]);
  if (!existing.n) {
    await query(
      'INSERT IGNORE INTO categories (user_id, slug, name, icon, color, is_default) VALUES ?',
      [DEFAULT_CATEGORIES.map((c) => [userId, c.slug, c.name, c.icon, c.color, 1])],
    );
  }
  const blocks = await one('SELECT COUNT(*) AS n FROM schedule_blocks WHERE user_id = ?', [userId]);
  if (!blocks.n) {
    const prefs = await getPreferences(userId);
    await query(
      'INSERT INTO schedule_blocks (user_id, title, block_type, days, start_time, end_time, icon) VALUES ?',
      [[
        [userId, 'Main Job', 'work', prefs.work_days.join(','), prefs.work_start, prefs.work_end, '💼'],
        [userId, 'Breakfast', 'meal', 'MON,TUE,WED,THU,FRI,SAT,SUN', '07:30', '08:00', '🍳'],
        [userId, 'Dinner', 'meal', 'MON,TUE,WED,THU,FRI,SAT,SUN', '21:00', '21:30', '🍽️'],
      ]],
    );
  }
}

function shapePrefs(p) {
  if (!p) return null;
  return {
    ...p,
    wake_time: normTime(p.wake_time),
    sleep_time: normTime(p.sleep_time),
    work_start: normTime(p.work_start),
    work_end: normTime(p.work_end),
    work_days: parseDays(p.work_days),
    default_vibration: !!p.default_vibration,
    onboarded: !!p.onboarded,
  };
}

async function getPreferences(userId) {
  let p = await one('SELECT * FROM user_preferences WHERE user_id = ?', [userId]);
  if (!p) {
    await query('INSERT IGNORE INTO user_preferences (user_id) VALUES (?)', [userId]);
    p = await one('SELECT * FROM user_preferences WHERE user_id = ?', [userId]);
  }
  return shapePrefs(p);
}

const BOOL_NOTIF = ['web_push', 'mobile_push', 'in_app', 'upcoming_tasks', 'deadlines', 'reminders', 'daily_briefing', 'weekly_planning', 'missed_tasks', 'daily_review'];

async function getNotificationPreferences(userId) {
  let p = await one('SELECT * FROM notification_preferences WHERE user_id = ?', [userId]);
  if (!p) {
    await query('INSERT IGNORE INTO notification_preferences (user_id) VALUES (?)', [userId]);
    p = await one('SELECT * FROM notification_preferences WHERE user_id = ?', [userId]);
  }
  const out = { ...p };
  BOOL_NOTIF.forEach((k) => (out[k] = !!p[k]));
  ['daily_briefing_time', 'weekly_planning_time', 'quiet_hours_start', 'quiet_hours_end'].forEach((k) => (out[k] = normTime(p[k])));
  return out;
}

async function getUser(userId) {
  return one('SELECT id, name, email, timezone, theme, role, created_at FROM users WHERE id = ?', [userId]);
}

async function listCategories(userId) {
  return query('SELECT id, name, slug, icon, color, is_default FROM categories WHERE user_id = ? ORDER BY is_default DESC, id', [userId]);
}

/** Resolve a category by id, slug or loose name ("fitness", "workout" -> fitness handled by AI layer). */
async function resolveCategory(userId, ref) {
  if (!ref) return null;
  if (typeof ref === 'number') return one('SELECT * FROM categories WHERE id = ? AND user_id = ?', [ref, userId]);
  return one('SELECT * FROM categories WHERE user_id = ? AND (slug = ? OR LOWER(name) = ?) LIMIT 1', [userId, slugify(ref), String(ref).toLowerCase()]);
}

module.exports = {
  DEFAULT_CATEGORIES,
  slugify,
  ensureUserDefaults,
  getPreferences,
  getNotificationPreferences,
  getUser,
  listCategories,
  resolveCategory,
};
