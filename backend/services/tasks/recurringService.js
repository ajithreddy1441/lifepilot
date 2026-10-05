const { query, one } = require('../../config/db');
const { DateTime } = require('../../utils/time');
const { upcomingOccurrences } = require('../alarms/recurrence');
const taskService = require('./taskService');

const HORIZON_DAYS = 14;

const asRule = (rt) => ({
  alarm_date: rt.start_date,
  alarm_time: rt.start_time,
  timezone: rt.timezone,
  repeat_type: rt.repeat_type,
  repeat_days: rt.repeat_days,
  repeat_interval_days: rt.interval_days,
  repeat_until: rt.end_date,
});

/** Materialise concrete task rows for the next HORIZON_DAYS. Idempotent via uq_task_recurring_occurrence. */
async function generate(rt) {
  const horizon = DateTime.now().plus({ days: HORIZON_DAYS }).toJSDate();
  const occurrences = upcomingOccurrences(asRule(rt), 60, new Date(Date.now() - 60000)).filter((d) => d <= horizon);
  let created = 0;
  for (const start of occurrences) {
    const exists = await one('SELECT id FROM tasks WHERE recurring_task_id = ? AND start_at = ?', [rt.id, start]);
    if (exists) continue;
    await taskService.create(
      rt.user_id,
      {
        title: rt.title,
        description: rt.description,
        category_id: rt.category_id,
        start_at: start.toISOString(),
        duration_minutes: rt.duration_minutes,
        priority: rt.priority,
        reminder_minutes: rt.reminder_minutes,
        recurring_task_id: rt.id,
        source: 'recurring',
      },
      { skipConflictCheck: true },
    );
    created += 1;
  }
  await query('UPDATE recurring_tasks SET last_generated_date = UTC_DATE() WHERE id = ?', [rt.id]);
  return created;
}

async function createFromTask(userId, task, repeat, tz) {
  const start = DateTime.fromJSDate(new Date(task.start_at)).setZone(tz);
  const res = await query(
    `INSERT INTO recurring_tasks (user_id, category_id, title, description, repeat_type, repeat_days, interval_days, start_time, duration_minutes, priority, reminder_minutes, start_date, end_date, timezone)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      userId, task.category_id || null, task.title, task.description || null, repeat.repeat_type,
      repeat.repeat_days ? repeat.repeat_days.join(',') : null, repeat.interval_days || null,
      start.toFormat('HH:mm'), task.duration_minutes || 30, task.priority || 'medium', task.reminder_minutes ?? null,
      start.toISODate(), repeat.end_date || null, tz,
    ],
  );
  await query('UPDATE tasks SET recurring_task_id = ? WHERE id = ?', [res.insertId, task.id]);
  const rt = await one('SELECT * FROM recurring_tasks WHERE id = ?', [res.insertId]);
  await generate(rt);
  return rt;
}

async function generateAll() {
  const rows = await query('SELECT * FROM recurring_tasks WHERE active = 1 AND (end_date IS NULL OR end_date >= UTC_DATE())');
  let total = 0;
  for (const rt of rows) {
    try {
      total += await generate(rt);
    } catch (err) {
      console.error(`[recurring] ${rt.id}:`, err.message);
    }
  }
  return total;
}

module.exports = { generate, generateAll, createFromTask };
