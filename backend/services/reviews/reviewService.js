const { query, one } = require('../../config/db');
const { toJson, parseJson } = require('../../utils/json');
const { DateTime, dayBoundsUtc, todayIn, weekStart, inZone } = require('../../utils/time');
const { getUser } = require('../../models/userModel');
const llm = require('../ai/llmClient');

async function daily(userId, date) {
  const user = await getUser(userId);
  const tz = user.timezone;
  const day = date || todayIn(tz);
  const { start, end } = dayBoundsUtc(day, tz);
  const tasks = await query(
    `SELECT t.id, t.title, t.status, t.start_at, t.end_at, t.duration_minutes, t.priority, c.icon AS category_icon, c.name AS category_name
     FROM tasks t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id = ? AND t.start_at >= ? AND t.start_at < ? AND t.status <> 'cancelled' ORDER BY t.start_at`,
    [userId, start, end],
  );
  const completed = tasks.filter((t) => t.status === 'completed');
  const incomplete = tasks.filter((t) => t.status !== 'completed');
  const summary = tasks.length
    ? `${completed.length} of ${tasks.length} done${incomplete.length ? `. ${incomplete.length === 1 ? `"${incomplete[0].title}" is` : `${incomplete.length} tasks are`} still open — want to reschedule?` : '. Great day!'}`
    : 'No scheduled tasks for this day.';
  await query(
    `INSERT INTO daily_reviews (user_id, review_date, completed_count, total_count, summary) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE completed_count = VALUES(completed_count), total_count = VALUES(total_count), summary = VALUES(summary)`,
    [userId, day, completed.length, tasks.length, summary],
  );
  const saved = await one('SELECT mood, notes FROM daily_reviews WHERE user_id = ? AND review_date = ?', [userId, day]);
  return { date: day, completed, incomplete, completed_count: completed.length, total_count: tasks.length, summary, mood: saved?.mood ?? null, notes: saved?.notes ?? '' };
}

async function saveDailyNotes(userId, date, { mood, notes }) {
  await query(
    `INSERT INTO daily_reviews (user_id, review_date, mood, notes) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE mood = VALUES(mood), notes = VALUES(notes)`,
    [userId, date, mood ?? null, notes ?? null],
  );
}

function hourLabel(h) {
  const f = (x) => DateTime.fromObject({ hour: x % 24 }).toFormat('h:mm a');
  return `${f(h)} – ${f(h + 2)}`;
}

async function weekly(userId, start) {
  const user = await getUser(userId);
  const tz = user.timezone;
  const ws = weekStart(start || todayIn(tz), tz);
  const from = DateTime.fromISO(ws, { zone: tz }).startOf('day');
  const to = from.plus({ days: 7 });
  const tasks = await query(
    `SELECT t.title, t.status, t.start_at, t.duration_minutes, c.slug, c.name AS category_name FROM tasks t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id = ? AND t.start_at >= ? AND t.start_at < ? AND t.status <> 'cancelled'`,
    [userId, from.toUTC().toJSDate(), to.toUTC().toJSDate()],
  );
  const done = tasks.filter((t) => t.status === 'completed');
  const byCat = {};
  for (const t of tasks) {
    const k = t.slug || 'other';
    byCat[k] = byCat[k] || { name: t.category_name || 'Other', planned: 0, done: 0, minutes: 0 };
    byCat[k].planned += 1;
    if (t.status === 'completed') { byCat[k].done += 1; byCat[k].minutes += t.duration_minutes; }
  }
  const doneHours = new Array(24).fill(0);
  const missedHours = new Array(24).fill(0);
  const now = new Date();
  for (const t of tasks) {
    const h = inZone(t.start_at, tz).hour;
    if (t.status === 'completed') doneHours[h] += 1;
    else if (new Date(t.start_at) < now) missedHours[h] += 1;
  }
  const best2h = (arr) => {
    let bi = -1; let bv = 0;
    for (let h = 0; h < 23; h += 1) if (arr[h] + arr[h + 1] > bv) { bv = arr[h] + arr[h + 1]; bi = h; }
    return bi >= 0 ? hourLabel(bi) : null;
  };
  const stats = {
    week_start: ws,
    tasks_completed: done.length,
    tasks_total: tasks.length,
    categories: byCat,
    fitness: byCat.fitness ? `${byCat.fitness.done} / ${byCat.fitness.planned} workouts` : '0 workouts',
    writing_sessions: byCat.creative?.done || 0,
    freelance_hours: Math.round(((byCat.freelancing?.minutes || 0) / 60) * 10) / 10,
    most_productive: best2h(doneHours),
    most_missed: best2h(missedHours),
  };

  let recommendation = null;
  if (llm.isConfigured() && tasks.length) {
    try {
      recommendation = await llm.chat([
        { role: 'system', content: 'You are a concise productivity coach. Give ONE practical recommendation (max 2 sentences) based on the weekly stats. No fluff.' },
        { role: 'user', content: JSON.stringify(stats) },
      ], { maxTokens: 120, temperature: 0.4 });
    } catch { /* fall through to rule-based */ }
  }
  if (!recommendation) {
    const rate = tasks.length ? done.length / tasks.length : 0;
    if (!tasks.length) recommendation = 'Plan a few key tasks for next week so I can help you track progress.';
    else if (stats.most_missed && stats.most_productive) recommendation = `You finish most around ${stats.most_productive} and miss most around ${stats.most_missed}. Move demanding tasks into your productive window next week.`;
    else if (rate < 0.6) recommendation = 'Your plan was heavier than your week allowed. Schedule ~20% fewer tasks and leave buffer time.';
    else recommendation = 'Solid week. Keep the same rhythm and add one stretch goal.';
  }
  await query(
    `INSERT INTO weekly_reviews (user_id, week_start, stats, recommendation) VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE stats = VALUES(stats), recommendation = VALUES(recommendation)`,
    [userId, ws, toJson(stats), recommendation],
  );
  return { ...stats, recommendation };
}

async function analytics(userId, range = 'week') {
  const user = await getUser(userId);
  const tz = user.timezone;
  const today = DateTime.now().setZone(tz).startOf('day');
  const days = range === 'month' ? 30 : range === 'year' ? 365 : 7;
  const from = today.minus({ days: days - 1 });
  const tasks = await query(
    `SELECT t.status, t.start_at, t.duration_minutes, c.slug, c.name AS category_name, c.color FROM tasks t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id = ? AND t.start_at >= ? AND t.start_at < ? AND t.status <> 'cancelled'`,
    [userId, from.toUTC().toJSDate(), today.plus({ days: 1 }).toUTC().toJSDate()],
  );
  const perDay = Array.from({ length: Math.min(days, 31) }, (_, i) => {
    const d = (days > 31 ? today.minus({ days: 30 - i }) : from.plus({ days: i })).toISODate();
    return { date: d, completed: 0, total: 0 };
  });
  const idx = Object.fromEntries(perDay.map((p, i) => [p.date, i]));
  const cats = {};
  let focus = 0;
  const hours = new Array(24).fill(0);
  for (const t of tasks) {
    const local = inZone(t.start_at, tz);
    const i = idx[local.toISODate()];
    if (i !== undefined) { perDay[i].total += 1; if (t.status === 'completed') perDay[i].completed += 1; }
    if (t.status === 'completed') {
      focus += t.duration_minutes;
      hours[local.hour] += 1;
      const k = t.slug || 'other';
      cats[k] = cats[k] || { name: t.category_name || 'Other', color: t.color || '#94a3b8', minutes: 0 };
      cats[k].minutes += t.duration_minutes;
    }
  }
  const total = tasks.length;
  const completed = tasks.filter((t) => t.status === 'completed').length;
  const missed = tasks.filter((t) => t.status !== 'completed' && new Date(t.start_at) < new Date()).length;
  let peak = 0;
  for (let h = 0; h < 23; h += 1) if (hours[h] + hours[h + 1] > hours[peak] + hours[peak + 1]) peak = h;
  const habitRows = await query(
    `SELECT h.title, COUNT(l.id) AS done FROM habits h LEFT JOIN habit_logs l ON l.habit_id = h.id AND l.log_date >= ? WHERE h.user_id = ? AND h.active = 1 GROUP BY h.id`,
    [from.toISODate(), userId],
  );
  return {
    range,
    completion_rate: total ? Math.round((completed / total) * 100) : 0,
    completed,
    total,
    missed,
    focus_minutes: focus,
    most_productive: completed ? hourLabel(peak) : null,
    per_day: perDay,
    categories: Object.values(cats).sort((a, b) => b.minutes - a.minutes),
    habits: habitRows,
  };
}

async function latestWeekly(userId) {
  const r = await one('SELECT * FROM weekly_reviews WHERE user_id = ? ORDER BY week_start DESC LIMIT 1', [userId]);
  return r ? { ...parseJson(r.stats, {}), recommendation: r.recommendation } : null;
}

module.exports = { daily, saveDailyNotes, weekly, analytics, latestWeekly };
