const { query, one } = require('../config/db');
const { notFound } = require('../utils/http');
const activity = require('../services/activityService');

const n = (v) => Number(v || 0);

async function uniqueIn(fromSql) {
  const row = await one(`SELECT COUNT(DISTINCT user_id) AS n FROM activity_events WHERE ${fromSql}`);
  return n(row?.n);
}

async function overview(_req, res) {
  const today = activity.utcDate();
  const [
    users,
    admins,
    newToday,
    tasks,
    alarms,
    devices,
    habits,
    goals,
    notifications,
    dailyReaders,
    weeklyReaders,
    yearlyReaders,
    dailyStory,
    weeklyStory,
    yearlyStory,
    sessionSeries,
    storySeries,
  ] = await Promise.all([
    one('SELECT COUNT(*) AS n FROM users'),
    one("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'"),
    one('SELECT COUNT(*) AS n FROM users WHERE created_at >= UTC_DATE()'),
    one("SELECT COUNT(*) AS n FROM tasks WHERE status <> 'cancelled'"),
    one("SELECT COUNT(*) AS n FROM alarms WHERE status = 'active'"),
    one('SELECT COUNT(*) AS n FROM devices WHERE is_active = 1'),
    one('SELECT COUNT(*) AS n FROM habits WHERE active = 1'),
    one("SELECT COUNT(*) AS n FROM goals WHERE status = 'active'"),
    one("SELECT COUNT(*) AS n FROM notifications WHERE status = 'sent' AND sent_at >= UTC_DATE()"),
    uniqueIn("event_type = 'session' AND event_date = UTC_DATE()"),
    uniqueIn("event_type = 'session' AND event_date >= UTC_DATE() - INTERVAL 6 DAY"),
    uniqueIn("event_type = 'session' AND event_date >= UTC_DATE() - INTERVAL 364 DAY"),
    uniqueIn("event_type = 'story' AND event_date = UTC_DATE()"),
    uniqueIn("event_type = 'story' AND event_date >= UTC_DATE() - INTERVAL 6 DAY"),
    uniqueIn("event_type = 'story' AND event_date >= UTC_DATE() - INTERVAL 364 DAY"),
    activity.series('session', 14),
    activity.series('story', 14),
  ]);

  res.json({
    generated_at: new Date().toISOString(),
    today,
    totals: {
      users: n(users.n),
      admins: n(admins.n),
      new_users_today: n(newToday.n),
      tasks: n(tasks.n),
      alarms: n(alarms.n),
      devices: n(devices.n),
      habits: n(habits.n),
      goals: n(goals.n),
      notifications_sent_today: n(notifications.n),
    },
    readers: {
      daily: dailyReaders,
      weekly: weeklyReaders,
      yearly: yearlyReaders,
    },
    story_readers: {
      daily: dailyStory,
      weekly: weeklyStory,
      yearly: yearlyStory,
    },
    charts: { readers_14d: sessionSeries, story_readers_14d: storySeries },
  });
}

async function listUsers(req, res) {
  const q = String(req.query.q || '').trim();
  const role = req.query.role;
  const where = ['1=1'];
  const params = [];
  if (q) {
    where.push('(u.name LIKE ? OR u.email LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (role === 'admin' || role === 'user') {
    where.push('u.role = ?');
    params.push(role);
  }
  const rows = await query(
    `SELECT u.id, u.name, u.email, u.timezone, u.role, u.created_at, u.last_seen_at,
            (SELECT COUNT(*) FROM tasks t WHERE t.user_id = u.id AND t.status <> 'cancelled') AS tasks,
            (SELECT COUNT(*) FROM alarms a WHERE a.user_id = u.id AND a.status = 'active') AS alarms,
            (SELECT COUNT(*) FROM devices d WHERE d.user_id = u.id AND d.is_active = 1) AS devices,
            (SELECT COUNT(*) FROM activity_events e WHERE e.user_id = u.id AND e.event_type = 'session') AS reader_days,
            (SELECT COUNT(*) FROM activity_events e WHERE e.user_id = u.id AND e.event_type = 'story') AS story_days
     FROM users u
     WHERE ${where.join(' AND ')}
     ORDER BY u.created_at DESC
     LIMIT 500`,
    params,
  );
  res.json({ users: rows });
}

async function getUser(req, res) {
  const id = Number(req.params.id);
  const user = await one(
    'SELECT id, name, email, timezone, theme, role, created_at, last_seen_at FROM users WHERE id = ?',
    [id],
  );
  if (!user) throw notFound('User');
  const [tasks, alarms, devices, habits, goals, prefs, recentTasks] = await Promise.all([
    one("SELECT COUNT(*) AS total, SUM(status = 'completed') AS completed, SUM(status = 'missed') AS missed FROM tasks WHERE user_id = ? AND status <> 'cancelled'", [id]),
    one("SELECT COUNT(*) AS n FROM alarms WHERE user_id = ? AND status = 'active'", [id]),
    query('SELECT id, device_name, platform, last_seen, last_sync_at, is_active FROM devices WHERE user_id = ? ORDER BY last_seen DESC', [id]),
    one('SELECT COUNT(*) AS n FROM habits WHERE user_id = ? AND active = 1', [id]),
    one("SELECT COUNT(*) AS n FROM goals WHERE user_id = ? AND status = 'active'", [id]),
    one('SELECT wake_time, sleep_time, work_start, work_end, onboarded FROM user_preferences WHERE user_id = ?', [id]),
    query(
      `SELECT t.id, t.title, t.status, t.start_at, t.priority, c.name AS category_name, c.slug AS category_slug
       FROM tasks t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = ? ORDER BY t.updated_at DESC LIMIT 20`,
      [id],
    ),
  ]);
  res.json({
    user,
    stats: {
      tasks: n(tasks.total),
      completed: n(tasks.completed),
      missed: n(tasks.missed),
      alarms: n(alarms.n),
      habits: n(habits.n),
      goals: n(goals.n),
    },
    preferences: prefs,
    devices,
    recent_tasks: recentTasks,
  });
}

module.exports = { overview, listUsers, getUser };
