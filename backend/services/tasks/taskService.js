const { query, one } = require('../../config/db');
const { HttpError, notFound } = require('../../utils/http');
const { publish } = require('../../utils/events');
const { humanTime, humanDate, inZone, timeToMinutes, dayCode, parseDays } = require('../../utils/time');
const { getUser, getPreferences } = require('../../models/userModel');
const notifications = require('../notifications/notificationService');
const alarms = require('../alarms/alarmService');

const COLS = ['title', 'description', 'category_id', 'goal_id', 'habit_id', 'recurring_task_id', 'start_at', 'end_at', 'duration_minutes', 'due_at', 'priority', 'status', 'is_critical_deadline', 'reminder_minutes', 'alarm_enabled', 'source'];

const SELECT = `SELECT t.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color, c.slug AS category_slug,
  (SELECT a.id FROM alarms a WHERE a.task_id = t.id AND a.status = 'active' LIMIT 1) AS alarm_id
  FROM tasks t LEFT JOIN categories c ON c.id = t.category_id`;

function shape(t) {
  if (!t) return null;
  return { ...t, is_critical_deadline: !!t.is_critical_deadline, alarm_enabled: !!t.alarm_enabled };
}

async function list(userId, { from, to, status, category_id: categoryId, unscheduled, q, limit = 500 } = {}) {
  const where = ['t.user_id = ?'];
  const params = [userId];
  if (from) { where.push('(t.start_at >= ? OR (t.start_at IS NULL AND t.due_at >= ?))'); params.push(new Date(from), new Date(from)); }
  if (to) { where.push('(t.start_at < ? OR (t.start_at IS NULL AND (t.due_at < ? OR t.due_at IS NULL)))'); params.push(new Date(to), new Date(to)); }
  if (status) { where.push(`t.status IN (?)`); params.push(String(status).split(',')); }
  if (categoryId) { where.push('t.category_id = ?'); params.push(Number(categoryId)); }
  if (unscheduled === 'true' || unscheduled === true) where.push('t.start_at IS NULL');
  if (q) { where.push('t.title LIKE ?'); params.push(`%${q}%`); }
  const rows = await query(
    `${SELECT} WHERE ${where.join(' AND ')} ORDER BY t.start_at IS NULL, t.start_at, t.due_at IS NULL, t.due_at, t.id LIMIT ?`,
    [...params, Math.min(Number(limit) || 500, 1000)],
  );
  return rows.map(shape);
}

async function get(userId, id) {
  const t = shape(await one(`${SELECT} WHERE t.id = ? AND t.user_id = ?`, [id, userId]));
  if (!t) throw notFound('Task');
  return t;
}

/** Overlapping active tasks plus fixed schedule blocks (work, meals) for the window. */
async function findConflicts(userId, start, end, excludeId = null) {
  const tasks = await query(
    `SELECT id, title, start_at, end_at FROM tasks
     WHERE user_id = ? AND status IN ('pending','in_progress') AND start_at IS NOT NULL
       AND start_at < ? AND end_at > ? ${excludeId ? 'AND id <> ?' : ''}`,
    excludeId ? [userId, end, start, excludeId] : [userId, end, start],
  );
  const user = await getUser(userId);
  const prefs = await getPreferences(userId);
  const s = inZone(start, user.timezone);
  const e = inZone(end, user.timezone);
  const blocks = await query('SELECT * FROM schedule_blocks WHERE user_id = ? AND active = 1', [userId]);
  const blockHits = [];
  for (let d = s.startOf('day'); d <= e; d = d.plus({ days: 1 })) {
    for (const b of blocks) {
      if (!parseDays(b.days).includes(dayCode(d))) continue;
      const bs = d.plus({ minutes: timeToMinutes(b.start_time) });
      const be = d.plus({ minutes: timeToMinutes(b.end_time) });
      if (bs < e && be > s) blockHits.push({ title: b.title, block_type: b.block_type });
    }
  }
  const warnings = [];
  const wake = timeToMinutes(prefs.wake_time);
  const sleep = timeToMinutes(prefs.sleep_time);
  const sm = s.hour * 60 + s.minute;
  const em = e.hour * 60 + e.minute + (e.startOf('day') > s.startOf('day') ? 1440 : 0);
  const sleepEnd = sleep > wake ? sleep : sleep + 1440;
  if (sm < wake || em > sleepEnd) warnings.push(`This runs outside your waking hours (${prefs.wake_time}–${prefs.sleep_time}).`);
  blockHits.forEach((b) => warnings.push(`Overlaps your ${b.title} block.`));
  return { conflicts: tasks, warnings };
}

async function scheduleNotifications(task, tz) {
  await notifications.cancelForTask(task.id);
  if (!['pending', 'in_progress'].includes(task.status)) return;
  const now = Date.now();
  if (task.start_at && !task.alarm_enabled) {
    const start = new Date(task.start_at);
    const remind = task.reminder_minutes;
    if (remind !== null && remind !== undefined) {
      const at = new Date(start.getTime() - remind * 60000);
      if (at.getTime() > now) {
        await notifications.schedule(task.user_id, {
          type: 'task_reminder',
          title: remind ? `🔔 ${task.title} starts in ${remind} minutes` : `▶️ ${task.title} starts now`,
          message: `${humanTime(start, tz)}${task.end_at ? ` – ${humanTime(task.end_at, tz)}` : ''}`,
          scheduledAt: at,
          taskId: task.id,
          dedupeKey: `task-rem:${task.id}:${start.toISOString()}`,
          priority: task.priority === 'high' || task.priority === 'critical' ? 'high' : 'normal',
        });
      }
    }
  }
  if (task.due_at) {
    const due = new Date(task.due_at);
    for (const [hours, label] of [[24, 'tomorrow'], [1, 'in 1 hour']]) {
      const at = new Date(due.getTime() - hours * 3600000);
      if (at.getTime() > now) {
        await notifications.schedule(task.user_id, {
          type: 'deadline',
          title: `⚠️ Deadline ${label}: ${task.title}`,
          message: `Due ${humanDate(due, tz)} at ${humanTime(due, tz)}`,
          scheduledAt: at,
          taskId: task.id,
          dedupeKey: `deadline:${task.id}:${hours}:${due.toISOString()}`,
          priority: 'high',
        });
      }
    }
  }
}

function computeWindow(data, current = {}) {
  const startRaw = data.start_at !== undefined ? data.start_at : current.start_at;
  const duration = Number(data.duration_minutes ?? current.duration_minutes ?? 30);
  if (!startRaw) return { start_at: null, end_at: null, duration_minutes: duration };
  const start = new Date(startRaw);
  return { start_at: start, end_at: new Date(start.getTime() + duration * 60000), duration_minutes: duration };
}

async function afterWrite(userId, taskId, reason) {
  const user = await getUser(userId);
  const task = await get(userId, taskId);
  await scheduleNotifications(task, user.timezone);
  await alarms.syncTaskAlarm(userId, task);
  publish(userId, 'tasks_changed', { taskId, reason });
  return get(userId, taskId);
}

async function create(userId, data, { skipConflictCheck = false } = {}) {
  const prefs = await getPreferences(userId);
  const win = computeWindow(data);
  let warnings = [];
  if (win.start_at && !skipConflictCheck) {
    const c = await findConflicts(userId, win.start_at, win.end_at);
    warnings = c.warnings;
    if (c.conflicts.length && !data.force) {
      throw new HttpError(409, `Overlaps with "${c.conflicts[0].title}"`, { conflicts: c.conflicts, warnings });
    }
  }
  const row = {
    priority: 'medium',
    status: 'pending',
    source: 'manual',
    reminder_minutes: win.start_at ? prefs.default_reminder_minutes : null,
    ...data,
    ...win,
    due_at: data.due_at ? new Date(data.due_at) : null,
  };
  const cols = COLS.filter((c) => row[c] !== undefined);
  const res = await query(
    `INSERT INTO tasks (user_id, ${cols.join(', ')}) VALUES (?, ${cols.map(() => '?').join(', ')})`,
    [userId, ...cols.map((c) => (typeof row[c] === 'boolean' ? Number(row[c]) : row[c]))],
  );
  const task = await afterWrite(userId, res.insertId, 'task_created');
  require('../activityService').touchStoryFromTask(userId, task).catch(() => {});
  return { ...task, warnings };
}

async function update(userId, id, patch) {
  const current = await one('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [id, userId]);
  if (!current) throw notFound('Task');
  if (patch.version !== undefined && Number(patch.version) !== current.version) {
    throw new HttpError(409, 'This task was changed elsewhere. Reload and try again.');
  }
  const row = { ...patch };
  let warnings = [];
  if (patch.start_at !== undefined || patch.duration_minutes !== undefined) {
    Object.assign(row, computeWindow(patch, current));
    if (row.start_at && !patch.force) {
      const c = await findConflicts(userId, row.start_at, row.end_at, id);
      warnings = c.warnings;
      if (c.conflicts.length) throw new HttpError(409, `Overlaps with "${c.conflicts[0].title}"`, { conflicts: c.conflicts, warnings });
    }
  }
  if (patch.due_at !== undefined) row.due_at = patch.due_at ? new Date(patch.due_at) : null;
  if (patch.status === 'completed' && current.status !== 'completed') row.completed_at = new Date();
  if (patch.status && patch.status !== 'completed') row.completed_at = null;
  const cols = [...COLS, 'completed_at'].filter((c) => row[c] !== undefined);
  if (!cols.length) return get(userId, id);
  await query(
    `UPDATE tasks SET ${cols.map((c) => `${c} = ?`).join(', ')}, version = version + 1 WHERE id = ?`,
    [...cols.map((c) => (typeof row[c] === 'boolean' ? Number(row[c]) : row[c])), id],
  );
  if (row.status === 'completed' && current.habit_id) {
    const user = await getUser(userId);
    const day = inZone(current.start_at || new Date(), user.timezone).toISODate();
    await query('INSERT IGNORE INTO habit_logs (habit_id, user_id, log_date) VALUES (?, ?, ?)', [current.habit_id, userId, day]);
  }
  const task = await afterWrite(userId, id, 'task_updated');
  if (row.status === 'completed' || current.status === 'completed') {
    const activity = require('../activityService');
    activity.touchStoryFromTask(userId, task).catch(() => {});
  }
  return { ...task, warnings };
}

const complete = (userId, id) => update(userId, id, { status: 'completed' });

const reschedule = (userId, id, { start_at: startAt, duration_minutes: duration, force }) =>
  update(userId, id, { start_at: startAt, duration_minutes: duration, force, status: 'pending' });

async function remove(userId, id) {
  const t = await one('SELECT id FROM tasks WHERE id = ? AND user_id = ?', [id, userId]);
  if (!t) throw notFound('Task');
  const linked = await query("SELECT id FROM alarms WHERE task_id = ? AND status = 'active'", [id]);
  for (const a of linked) await alarms.remove(userId, a.id);
  await query('DELETE FROM tasks WHERE id = ?', [id]);
  publish(userId, 'tasks_changed', { taskId: id, reason: 'task_deleted' });
  return true;
}

/** Fuzzy title match among a user's open tasks, preferring ones closest to `around`. */
async function findByTitle(userId, text, { around, from, to } = {}) {
  const words = String(text).toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !['task', 'the', 'my', 'for', 'and'].includes(w));
  if (!words.length) return [];
  const params = [userId];
  let range = '';
  if (from) { range += ' AND (t.start_at >= ? OR t.start_at IS NULL)'; params.push(from); }
  if (to) { range += ' AND (t.start_at < ? OR t.start_at IS NULL)'; params.push(to); }
  const rows = await query(`${SELECT} WHERE t.user_id = ? AND t.status IN ('pending','in_progress','missed') ${range} ORDER BY t.start_at LIMIT 300`, params);
  const ref = around ? new Date(around).getTime() : Date.now();
  return rows
    .map((t) => {
      const hay = `${t.title} ${t.category_name || ''} ${t.category_slug || ''}`.toLowerCase();
      const score = words.reduce((s, w) => s + (hay.includes(w) || (w.length > 4 && hay.includes(w.slice(0, -1))) ? 1 : 0), 0);
      const distance = t.start_at ? Math.abs(new Date(t.start_at).getTime() - ref) : 9e15;
      return { t: shape(t), score, distance };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.distance - b.distance)
    .map((x) => x.t);
}

module.exports = { list, get, create, update, complete, reschedule, remove, findConflicts, findByTitle, scheduleNotifications, shape };
