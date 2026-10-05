const { query, one } = require('../../config/db');
const { DateTime, todayIn } = require('../../utils/time');
const { getUser } = require('../../models/userModel');
const engine = require('./schedulingEngine');
const taskService = require('../tasks/taskService');
const { nextOccurrence } = require('../alarms/recurrence');
const alarmService = require('../alarms/alarmService');

async function getDay(userId, date) {
  const user = await getUser(userId);
  const tz = user.timezone;
  const day = date || todayIn(tz);
  const { ctxs } = await engine.loadDays(userId, [day]);
  const ctx = ctxs[day];
  const tasks = ctx.busy.filter((b) => b.type === 'task').map((b) => b.task)
    .filter((t) => DateTime.fromJSDate(new Date(t.start_at)).setZone(tz).toISODate() === day);
  const completed = tasks.filter((t) => t.status === 'completed').length;

  const start = ctx.dayStart.toUTC().toJSDate();
  const end = ctx.dayStart.plus({ days: 1 }).toUTC().toJSDate();
  const alarmRows = await query("SELECT * FROM alarms WHERE user_id = ? AND status = 'active' AND enabled = 1", [userId]);
  const alarmsToday = alarmRows
    .map((a) => ({ a: alarmService.shape(a), at: nextOccurrence(a, new Date(start.getTime() - 1000)) }))
    .filter((x) => x.at && x.at < end)
    .map((x) => ({ id: x.a.id, title: x.a.title, task_id: x.a.task_id, at: x.at.toISOString(), repeat_label: x.a.repeat_label }));

  const now = new Date();
  const nextTask = await one(
    `SELECT t.*, c.icon AS category_icon, c.name AS category_name, c.color AS category_color,
       (SELECT a.id FROM alarms a WHERE a.task_id = t.id AND a.status = 'active' AND a.enabled = 1 LIMIT 1) AS alarm_id
     FROM tasks t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id = ? AND t.status IN ('pending','in_progress') AND t.end_at > ? ORDER BY t.start_at LIMIT 1`,
    [userId, now],
  );

  return {
    date: day,
    timezone: tz,
    timeline: engine.timelineFor(ctx),
    alarms: alarmsToday,
    progress: { completed, total: tasks.length, percent: tasks.length ? Math.round((completed / tasks.length) * 100) : 0 },
    next_up: nextTask ? taskService.shape(nextTask) : null,
  };
}

async function getWeek(userId, start) {
  const user = await getUser(userId);
  const tz = user.timezone;
  const first = DateTime.fromISO(start || todayIn(tz), { zone: tz }).startOf('week');
  const dates = Array.from({ length: 7 }, (_, i) => first.plus({ days: i }).toISODate());
  const { ctxs } = await engine.loadDays(userId, dates);
  return {
    week_start: dates[0],
    timezone: tz,
    days: dates.map((d) => ({
      date: d,
      timeline: engine.timelineFor(ctxs[d]).filter((i) => i.kind !== 'marker'),
    })),
  };
}

/** Commit an accepted plan. Each item either moves an existing task or creates a new one. */
async function applyPlan(userId, items, source = 'plan') {
  const results = [];
  for (const item of items) {
    try {
      let task;
      if (item.task_id) {
        task = await taskService.reschedule(userId, item.task_id, { start_at: item.start_at, duration_minutes: item.duration_minutes });
      } else {
        task = await taskService.create(userId, {
          title: item.title,
          start_at: item.start_at,
          duration_minutes: item.duration_minutes,
          category_id: item.category_id || undefined,
          habit_id: item.habit_id || undefined,
          priority: item.priority || 'medium',
          alarm_enabled: !!item.alarm,
          source: item.habit_id ? 'habit' : source,
        });
      }
      results.push({ ok: true, task_id: task.id, title: task.title });
    } catch (err) {
      results.push({ ok: false, title: item.title, error: err.message });
    }
  }
  return { results, created: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok) };
}

module.exports = { getDay, getWeek, applyPlan };
