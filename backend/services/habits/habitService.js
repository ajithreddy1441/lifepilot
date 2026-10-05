const { query, one } = require('../../config/db');
const { notFound } = require('../../utils/http');
const { publish } = require('../../utils/events');
const { normTime, parseDays, formatDays, todayIn, weekStart, DateTime, DAY_CODES } = require('../../utils/time');
const { getUser } = require('../../models/userModel');
const alarmService = require('../alarms/alarmService');

async function shapeWithStats(h, tz) {
  const today = todayIn(tz);
  const ws = weekStart(today, tz);
  const logs = await query('SELECT log_date FROM habit_logs WHERE habit_id = ? AND log_date >= ? - INTERVAL 60 DAY ORDER BY log_date DESC', [h.id, today]);
  const dates = new Set(logs.map((l) => l.log_date));
  let streak = 0;
  const days = parseDays(h.repeat_days);
  const floor = DateTime.fromISO(today).minus({ days: 60 });
  for (let d = DateTime.fromISO(today); d > floor; d = d.minus({ days: 1 })) {
    const iso = d.toISODate();
    if (dates.has(iso)) streak += 1;
    else if (days.includes(DAY_CODES[d.weekday - 1]) && iso !== today) break; // a missed scheduled day ends the streak
  }
  const week = Array.from({ length: 7 }, (_, i) => {
    const d = DateTime.fromISO(ws).plus({ days: i }).toISODate();
    return { date: d, done: dates.has(d), scheduled: days.includes(DAY_CODES[i]) };
  });
  return {
    ...h,
    reminder_time: normTime(h.reminder_time),
    repeat_days: days,
    active: !!h.active,
    alarm_enabled: !!h.alarm_id,
    done_today: dates.has(today),
    week,
    week_count: week.filter((w) => w.done).length,
    streak,
  };
}

async function list(userId) {
  const user = await getUser(userId);
  const rows = await query(
    `SELECT h.*, c.name AS category_name, c.color AS category_color, a.sound AS alarm_sound FROM habits h
     LEFT JOIN categories c ON c.id = h.category_id LEFT JOIN alarms a ON a.id = h.alarm_id
     WHERE h.user_id = ? ORDER BY h.active DESC, h.reminder_time IS NULL, h.reminder_time, h.id`,
    [userId],
  );
  return Promise.all(rows.map((h) => shapeWithStats(h, user.timezone)));
}

async function syncAlarm(userId, habit, alarmEnabled) {
  const wants = habit.active && habit.reminder_time;
  if (!wants) {
    if (habit.alarm_id) await alarmService.remove(userId, habit.alarm_id).catch(() => {});
    await query('UPDATE habits SET alarm_id = NULL WHERE id = ?', [habit.id]);
    return;
  }
  const user = await getUser(userId);
  const fields = {
    title: habit.title,
    alarm_date: todayIn(user.timezone),
    alarm_time: normTime(habit.reminder_time),
    repeat_type: parseDays(habit.repeat_days).length === 7 ? 'daily' : 'selected_days',
    repeat_days: parseDays(habit.repeat_days),
    duration_minutes: habit.duration_minutes,
    reminder_minutes: habit.reminder_minutes,
    category_id: habit.category_id,
    // 'silent' alarms are delivered as plain reminders on the phone instead of ringing.
    sound: alarmEnabled ? 'default' : 'silent',
  };
  if (habit.alarm_id) {
    const existing = await one("SELECT id FROM alarms WHERE id = ? AND status = 'active'", [habit.alarm_id]);
    if (existing) { await alarmService.update(userId, habit.alarm_id, fields); return; }
  }
  const alarm = await alarmService.create(userId, fields);
  await query('UPDATE habits SET alarm_id = ? WHERE id = ?', [alarm.id, habit.id]);
}

async function create(userId, data) {
  const res = await query(
    `INSERT INTO habits (user_id, category_id, title, icon, repeat_days, target_per_week, reminder_time, duration_minutes, reminder_minutes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId, data.category_id || null, data.title, data.icon || '✅', formatDays(data.repeat_days || DAY_CODES), data.target_per_week || (data.repeat_days || DAY_CODES).length, data.reminder_time || null, data.duration_minutes || 30, data.reminder_minutes ?? 10],
  );
  const habit = await one('SELECT * FROM habits WHERE id = ?', [res.insertId]);
  await syncAlarm(userId, habit, data.alarm_enabled !== false);
  publish(userId, 'habits_changed', {});
  return habit;
}

async function update(userId, id, data) {
  const habit = await one('SELECT * FROM habits WHERE id = ? AND user_id = ?', [id, userId]);
  if (!habit) throw notFound('Habit');
  const map = { ...data };
  if (map.repeat_days) map.repeat_days = formatDays(map.repeat_days);
  const cols = ['category_id', 'title', 'icon', 'repeat_days', 'target_per_week', 'reminder_time', 'duration_minutes', 'reminder_minutes', 'active'].filter((c) => map[c] !== undefined);
  if (cols.length) {
    await query(`UPDATE habits SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...cols.map((c) => (typeof map[c] === 'boolean' ? Number(map[c]) : map[c])), id]);
  }
  const updated = await one('SELECT * FROM habits WHERE id = ?', [id]);
  const currentAlarm = habit.alarm_id ? await one('SELECT sound FROM alarms WHERE id = ?', [habit.alarm_id]) : null;
  await syncAlarm(userId, updated, data.alarm_enabled ?? (currentAlarm ? currentAlarm.sound !== 'silent' : true));
  publish(userId, 'habits_changed', {});
  return updated;
}

async function remove(userId, id) {
  const habit = await one('SELECT * FROM habits WHERE id = ? AND user_id = ?', [id, userId]);
  if (!habit) throw notFound('Habit');
  if (habit.alarm_id) await alarmService.remove(userId, habit.alarm_id).catch(() => {});
  await query('DELETE FROM habits WHERE id = ?', [id]);
  publish(userId, 'habits_changed', {});
}

async function toggleLog(userId, id, date) {
  const habit = await one('SELECT * FROM habits WHERE id = ? AND user_id = ?', [id, userId]);
  if (!habit) throw notFound('Habit');
  const user = await getUser(userId);
  const day = date || todayIn(user.timezone);
  const existing = await one('SELECT id FROM habit_logs WHERE habit_id = ? AND log_date = ?', [id, day]);
  if (existing) await query('DELETE FROM habit_logs WHERE id = ?', [existing.id]);
  else await query('INSERT INTO habit_logs (habit_id, user_id, log_date) VALUES (?, ?, ?)', [id, userId, day]);
  publish(userId, 'habits_changed', {});
  return { done: !existing, date: day };
}

module.exports = { list, create, update, remove, toggleLog };
