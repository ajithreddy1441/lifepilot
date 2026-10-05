const { query } = require('../../config/db');
const { DateTime, timeToMinutes, parseDays, dayCode, inZone } = require('../../utils/time');
const { getPreferences, getUser } = require('../../models/userModel');
const M = require('./slotMath');

const CATEGORY_WORDS = {
  fitness: { noun: 'workouts', verb: 'work out' },
  creative: { noun: 'creative work', verb: 'write' },
  freelancing: { noun: 'freelance work', verb: 'do freelance work' },
  learning: { noun: 'study sessions', verb: 'study' },
  job: { noun: 'work tasks', verb: 'work on this' },
};

function preferredWindow(slug, prefs) {
  switch (slug) {
    case 'fitness': return prefs.preferred_workout_time;
    case 'creative': return prefs.preferred_creative_time;
    case 'freelancing': return prefs.preferred_freelance_time;
    case 'learning': return 'evening';
    case 'home':
    case 'personal': return 'evening';
    default: return null;
  }
}

/** Load busy time for a range of local dates in one pass. */
async function loadDays(userId, dates) {
  const [user, prefs] = await Promise.all([getUser(userId), getPreferences(userId)]);
  const tz = user.timezone;
  const first = DateTime.fromISO(dates[0], { zone: tz }).startOf('day');
  const last = DateTime.fromISO(dates[dates.length - 1], { zone: tz }).startOf('day').plus({ days: 2 });
  const [tasks, blocks] = await Promise.all([
    query(
      `SELECT t.id, t.title, t.start_at, t.end_at, t.status, t.priority, t.duration_minutes, t.category_id, t.alarm_enabled, t.reminder_minutes,
              c.slug AS category_slug, c.icon AS category_icon, c.color AS category_color, c.name AS category_name
       FROM tasks t LEFT JOIN categories c ON c.id = t.category_id
       WHERE t.user_id = ? AND t.start_at IS NOT NULL AND t.status <> 'cancelled' AND t.start_at < ? AND t.end_at > ?`,
      [userId, last.toUTC().toJSDate(), first.minus({ days: 1 }).toUTC().toJSDate()],
    ),
    query('SELECT * FROM schedule_blocks WHERE user_id = ? AND active = 1', [userId]),
  ]);
  const ctxs = {};
  for (const date of dates) {
    const dayStart = DateTime.fromISO(date, { zone: tz }).startOf('day');
    const toMin = (d) => Math.round(inZone(d, tz).diff(dayStart, 'minutes').minutes);
    const busy = [];
    for (const b of blocks) {
      if (!parseDays(b.days).includes(dayCode(dayStart))) continue;
      const s = timeToMinutes(b.start_time);
      let e = timeToMinutes(b.end_time);
      if (e <= s) e += 1440;
      busy.push({ s, e, type: b.block_type === 'work' ? 'work' : 'block', title: b.title, icon: b.icon, block_id: b.id, block_type: b.block_type });
    }
    for (const t of tasks) {
      const s = toMin(t.start_at);
      const e = toMin(t.end_at);
      if (e <= 0 || s >= 1440 + 360) continue;
      busy.push({ s, e, type: 'task', title: t.title, task: t });
    }
    ctxs[date] = { date, dayStart, tz, prefs, busy, isWorkday: prefs.work_days.includes(dayCode(dayStart)) };
  }
  return { ctxs, tz, prefs, user };
}

async function historyAnchor(userId, { categoryId, title }, tz) {
  if (!categoryId && !title) return null;
  const rows = await query(
    `SELECT start_at FROM tasks WHERE user_id = ? AND start_at IS NOT NULL AND status IN ('completed','pending','in_progress')
       AND start_at > UTC_TIMESTAMP() - INTERVAL 45 DAY AND start_at < UTC_TIMESTAMP() + INTERVAL 7 DAY
       AND (${categoryId ? 'category_id = ?' : '0'} OR title LIKE ?)
     ORDER BY start_at DESC LIMIT 20`,
    categoryId ? [userId, categoryId, `%${title || '~~'}%`] : [userId, `%${title}%`],
  );
  if (rows.length < 2) return null;
  const mins = rows.map((r) => { const d = inZone(r.start_at, tz); return d.hour * 60 + d.minute; }).sort((a, b) => a - b);
  return { minute: mins[Math.floor(mins.length / 2)], samples: rows.length };
}

const fmt = (dayStart, m) => dayStart.plus({ minutes: m }).toFormat('h:mm a');

function buildReason(ctx, slot, { slug, preferred, anchor, deadline }) {
  const words = CATEGORY_WORDS[slug];
  const parts = [];
  if (anchor && Math.abs(slot.s - anchor.minute) <= 45) {
    parts.push(`you usually ${words ? words.verb : 'do this'} around ${fmt(ctx.dayStart, anchor.minute)}`);
  } else if (slot.inPreferred && preferred) {
    parts.push(`you prefer ${preferred} ${words ? words.noun : 'sessions'}`);
  }
  const work = ctx.busy.find((b) => b.type === 'work');
  if (work && slot.e <= work.s) parts.push(`you're free before work`);
  else if (work && slot.s >= work.e) parts.push(`your ${M.partOfDay(slot.s)} after work is open`);
  else parts.push(`your ${M.partOfDay(slot.s)} is currently free`);
  if (deadline) parts.push(`it lands before the ${deadline.toFormat('cccc')} deadline`);
  const range = `${fmt(ctx.dayStart, slot.s)}–${fmt(ctx.dayStart, slot.e)}`;
  return `${range} because ${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]}.`;
}

function toSlot(ctx, c, reason) {
  return {
    date: ctx.date,
    start_at: ctx.dayStart.plus({ minutes: c.s }).toUTC().toISO(),
    end_at: ctx.dayStart.plus({ minutes: c.e }).toUTC().toISO(),
    label: `${ctx.dayStart.toFormat('ccc d LLL')}, ${fmt(ctx.dayStart, c.s)}–${fmt(ctx.dayStart, c.e)}`,
    reason,
    score: Math.round(c.score),
  };
}

function earliestFor(ctx) {
  const now = DateTime.now().setZone(ctx.tz);
  if (ctx.dayStart.toISODate() !== now.toISODate()) return 0;
  return M.roundUp(now.diff(ctx.dayStart, 'minutes').minutes + 10, 5);
}

/**
 * Suggest the best time for a piece of work.
 * opts: { title, category_slug, category_id, duration, date, deadline, preferred, after (ISO), excludeTaskId, extraBusy: {date: [...]}}
 */
async function suggest(userId, opts) {
  const user = await getUser(userId);
  const tz = user.timezone;
  const today = DateTime.now().setZone(tz).startOf('day');
  const deadline = opts.deadline ? inZone(opts.deadline, tz) : null;
  let dates;
  if (opts.date) dates = [opts.date, ...[1, 2].map((i) => DateTime.fromISO(opts.date, { zone: tz }).plus({ days: i }).toISODate())];
  else {
    const span = deadline ? Math.max(1, Math.min(14, Math.ceil(deadline.startOf('day').diff(today, 'days').days) + 1)) : 7;
    dates = Array.from({ length: span }, (_, i) => today.plus({ days: i }).toISODate());
  }
  dates = dates.filter((d) => d >= today.toISODate());
  if (!dates.length) dates = [today.toISODate()];

  const { ctxs, prefs } = await loadDays(userId, dates);
  const slug = opts.category_slug || null;
  const preferred = opts.preferred || preferredWindow(slug, prefs);
  const anchor = opts.anchorMinute !== undefined
    ? { minute: opts.anchorMinute, samples: 99 }
    : await historyAnchor(userId, { categoryId: opts.category_id, title: opts.title }, tz);
  const duration = Number(opts.duration) || 30;
  const all = [];
  dates.forEach((date, idx) => {
    const ctx = ctxs[date];
    const busy = ctx.busy.filter((b) => !(b.task && b.task.id === opts.excludeTaskId)).concat(opts.extraBusy?.[date] || []);
    let earliest = earliestFor(ctx);
    if (opts.after) {
      const a = Math.round(inZone(opts.after, tz).diff(ctx.dayStart, 'minutes').minutes);
      earliest = Math.max(earliest, a);
    }
    const free = M.freeIntervals(prefs, busy, { category: slug, earliest });
    let cands = M.candidates(prefs, free, { duration, preferred, anchor: anchor?.minute, earliest });
    if (deadline) cands = cands.filter((c) => ctx.dayStart.plus({ minutes: c.e }) <= deadline);
    const dayPenalty = opts.date ? (idx === 0 ? 0 : 200 + idx * 20) : idx * 12;
    M.distinct(cands, 3).forEach((c) => all.push({ ctx, c: { ...c, score: c.score - dayPenalty } }));
  });
  all.sort((a, b) => b.c.score - a.c.score);
  const picked = [];
  for (const x of all) {
    if (picked.every((p) => p.ctx.date !== x.ctx.date || Math.abs(p.c.s - x.c.s) >= 60)) picked.push(x);
    if (picked.length >= 4) break;
  }
  const slots = picked.map(({ ctx, c }) => toSlot(ctx, c, buildReason(ctx, c, { slug, preferred, anchor, deadline })));
  return { best: slots[0] || null, alternatives: slots.slice(1), duration_minutes: duration, preferred_window: preferred };
}

/** Minutes of free time from `fromMinute` until sleep on a day. Used to protect sleep. */
async function freeMinutesRemaining(userId, date, fromMinute = null, category = null) {
  const { ctxs, prefs } = await loadDays(userId, [date]);
  const ctx = ctxs[date];
  const earliest = fromMinute ?? earliestFor(ctx);
  const free = M.freeIntervals(prefs, ctx.busy, { category, earliest });
  return { minutes: M.sum(free), free, sleep_time: prefs.sleep_time, ctx };
}

function timelineFor(ctx, extra = []) {
  const { wake, sleep } = M.dayBounds(ctx.prefs);
  const at = (m) => ctx.dayStart.plus({ minutes: m }).toUTC().toISO();
  const items = [
    { kind: 'marker', title: 'Wake Up', icon: '🌅', start_at: at(wake), end_at: at(wake) },
    ...ctx.busy.filter((b) => b.type !== 'task').map((b) => ({ kind: 'block', title: b.title, icon: b.icon, block_type: b.block_type, start_at: at(b.s), end_at: at(b.e) })),
    ...ctx.busy.filter((b) => b.type === 'task').map((b) => ({ kind: 'task', title: b.task.title, task: b.task, start_at: new Date(b.task.start_at).toISOString(), end_at: new Date(b.task.end_at).toISOString() })),
    ...extra,
    { kind: 'marker', title: 'Sleep', icon: '🌙', start_at: at(sleep), end_at: at(sleep) },
  ];
  return items.sort((a, b) => a.start_at.localeCompare(b.start_at));
}

async function candidatesForPlanning(userId, fromDate) {
  const unscheduled = await query(
    `SELECT t.*, c.slug AS category_slug, c.icon AS category_icon, c.name AS category_name FROM tasks t LEFT JOIN categories c ON c.id = t.category_id
     WHERE t.user_id = ? AND t.status IN ('pending','missed') AND (t.start_at IS NULL OR (t.start_at < ? AND t.start_at > ? AND t.status <> 'completed'))
       AND (t.due_at IS NULL OR t.due_at > ?)
     ORDER BY FIELD(t.priority,'critical','high','medium','low'), t.due_at IS NULL, t.due_at LIMIT 40`,
    [userId, fromDate, new Date(fromDate.getTime() - 3 * 86400000), fromDate],
  );
  const habits = await query(
    `SELECT h.*, c.slug AS category_slug FROM habits h LEFT JOIN categories c ON c.id = h.category_id WHERE h.user_id = ? AND h.active = 1`,
    [userId],
  );
  return { unscheduled, habits };
}

/** Propose a full day: keeps fixed blocks and existing tasks, fills free time with unscheduled work + habits. */
async function planDay(userId, date) {
  const { ctxs, prefs, tz } = await loadDays(userId, [date]);
  const ctx = ctxs[date];
  const dayStartUtc = ctx.dayStart.toUTC().toJSDate();
  const { unscheduled, habits } = await candidatesForPlanning(userId, dayStartUtc);
  const earliest = earliestFor(ctx);
  const virtual = [];
  const proposed = [];
  const unplaced = [];
  const warnings = [];

  const todaysHabitTasks = new Set(ctx.busy.filter((b) => b.task && b.task.habit_id).map((b) => b.task.habit_id));
  const queue = [
    ...habits
      .filter((h) => parseDays(h.repeat_days).includes(dayCode(ctx.dayStart)) && !todaysHabitTasks.has(h.id) && !h.alarm_id)
      .map((h) => ({ kind: 'habit', habit_id: h.id, title: h.title, icon: h.icon, category_id: h.category_id, category_slug: h.category_slug, duration: h.duration_minutes, anchor: h.reminder_time ? timeToMinutes(h.reminder_time) : null, priority: 'medium' })),
    ...unscheduled.map((t) => ({ kind: t.start_at ? 'reschedule' : 'task', task_id: t.id, title: t.title, icon: t.category_icon, category_id: t.category_id, category_slug: t.category_slug, duration: t.duration_minutes, priority: t.priority, due_at: t.due_at })),
  ];

  for (const item of queue) {
    const chunks = [];
    let remaining = item.duration;
    while (remaining > 0 && chunks.length < 3) {
      const len = Math.min(remaining, prefs.max_focus_minutes);
      chunks.push(len);
      remaining -= len;
    }
    let placedAll = true;
    chunks.forEach((len, i) => {
      const free = M.freeIntervals(prefs, [...ctx.busy, ...virtual], { category: item.category_slug, earliest });
      const [best] = M.candidates(prefs, free, { duration: len, preferred: preferredWindow(item.category_slug, prefs), anchor: item.anchor, earliest });
      if (!best) { placedAll = false; return; }
      virtual.push({ s: best.s, e: best.e, type: 'task' });
      proposed.push({
        kind: 'proposed',
        source: item.kind,
        task_id: i === 0 ? item.task_id : undefined,
        habit_id: item.habit_id,
        title: chunks.length > 1 ? `${item.title} (${i + 1}/${chunks.length})` : item.title,
        icon: item.icon,
        category_id: item.category_id,
        category_slug: item.category_slug,
        priority: item.priority,
        duration_minutes: len,
        start_at: ctx.dayStart.plus({ minutes: best.s }).toUTC().toISO(),
        end_at: ctx.dayStart.plus({ minutes: best.e }).toUTC().toISO(),
        reason: buildReason(ctx, best, { slug: item.category_slug, preferred: preferredWindow(item.category_slug, prefs) }),
        alarm: item.category_slug === 'fitness',
        notification: true,
      });
    });
    if (!placedAll) unplaced.push({ title: item.title, duration_minutes: item.duration, task_id: item.task_id });
  }

  const freeLeft = M.sum(M.freeIntervals(prefs, [...ctx.busy, ...virtual], { earliest }));
  if (unplaced.length) warnings.push(`${unplaced.length} item(s) don't fit today without cutting into sleep: ${unplaced.map((u) => u.title).join(', ')}.`);
  else if (freeLeft < 30 && proposed.length) warnings.push('This day is tightly packed — consider moving something to tomorrow.');

  return {
    date,
    timezone: tz,
    timeline: timelineFor(ctx, proposed),
    proposed,
    unplaced,
    warnings,
    free_minutes_after: freeLeft,
  };
}

/**
 * Propose a week. requests: [{title, category_slug, category_id, sessions, duration_minutes}]
 */
async function planWeek(userId, { start, requests = [] }) {
  const user = await getUser(userId);
  const tz = user.timezone;
  const today = DateTime.now().setZone(tz).startOf('day');
  let first = start ? DateTime.fromISO(start, { zone: tz }) : today;
  if (first < today) first = today;
  const weekEnd = first.startOf('week').plus({ days: 7 });
  const toWeekEnd = Math.round(weekEnd.diff(first, 'days').days);
  const span = toWeekEnd < 3 ? 7 : toWeekEnd; // late in the week, plan the next 7 days instead
  const dates = Array.from({ length: span }, (_, i) => first.plus({ days: i }).toISODate());
  const { ctxs, prefs } = await loadDays(userId, dates);

  const { unscheduled } = await candidatesForPlanning(userId, first.toUTC().toJSDate());
  const reqs = [
    ...requests,
    ...unscheduled
      .filter((t) => !t.start_at && (!t.due_at || inZone(t.due_at, tz) < first.plus({ days: span })))
      .slice(0, 10)
      .map((t) => ({ title: t.title, task_id: t.id, category_slug: t.category_slug, category_id: t.category_id, sessions: 1, duration_minutes: t.duration_minutes, due_at: t.due_at })),
  ];
  const virtual = Object.fromEntries(dates.map((d) => [d, []]));
  const load = Object.fromEntries(dates.map((d) => [d, ctxs[d].busy.filter((b) => b.type === 'task').reduce((s, b) => s + (b.e - b.s), 0)]));
  const placements = Object.fromEntries(dates.map((d) => [d, []]));
  const warnings = [];

  const sorted = [...reqs].sort((a, b) => (b.sessions || 1) - (a.sessions || 1));
  for (const r of sorted) {
    const sessions = Math.max(1, Math.min(14, r.sessions || 1));
    const used = [];
    for (let k = 0; k < sessions; k += 1) {
      const order = dates
        .map((d, i) => ({ d, i }))
        .filter(({ d, i }) => !(r.due_at && inZone(r.due_at, tz).startOf('day') < first.plus({ days: i })) && (sessions > dates.length || !used.includes(d)))
        .sort((a, b) => {
          const spread = (x) => (used.length ? Math.min(...used.map((u) => Math.abs(dates.indexOf(u) - x.i))) : 0);
          return load[a.d] - spread(a) * 45 - (load[b.d] - spread(b) * 45) || a.i - b.i;
        });
      let placed = false;
      for (const { d } of order) {
        const ctx = ctxs[d];
        const earliest = earliestFor(ctx);
        const free = M.freeIntervals(prefs, [...ctx.busy, ...virtual[d]], { category: r.category_slug, earliest });
        const [best] = M.candidates(prefs, free, { duration: r.duration_minutes || 60, preferred: preferredWindow(r.category_slug, prefs), earliest });
        if (!best) continue;
        virtual[d].push({ s: best.s, e: best.e, type: 'task' });
        load[d] += best.e - best.s;
        used.push(d);
        placements[d].push({
          kind: 'proposed',
          task_id: k === 0 ? r.task_id : undefined,
          title: r.title,
          category_id: r.category_id,
          category_slug: r.category_slug,
          duration_minutes: best.e - best.s,
          start_at: ctx.dayStart.plus({ minutes: best.s }).toUTC().toISO(),
          end_at: ctx.dayStart.plus({ minutes: best.e }).toUTC().toISO(),
          session: sessions > 1 ? `${k + 1}/${sessions}` : null,
        });
        placed = true;
        break;
      }
      if (!placed) {
        warnings.push(`Couldn't fit session ${k + 1} of "${r.title}" this week.`);
        break;
      }
    }
  }

  const reviewDay = dates.find((d) => dayCode(ctxs[d].dayStart) === 'SUN');
  if (reviewDay) {
    const ctx = ctxs[reviewDay];
    const free = M.freeIntervals(prefs, [...ctx.busy, ...virtual[reviewDay]], { earliest: earliestFor(ctx) });
    const [best] = M.candidates(prefs, free, { duration: 30, preferred: 'evening', anchor: 20 * 60 });
    if (best) {
      placements[reviewDay].push({ kind: 'proposed', title: 'Weekly Review & Planning', category_slug: 'goals', duration_minutes: 30, start_at: ctx.dayStart.plus({ minutes: best.s }).toUTC().toISO(), end_at: ctx.dayStart.plus({ minutes: best.e }).toUTC().toISO() });
    }
  }

  const days = dates.map((d) => {
    const ctx = ctxs[d];
    const cap = ctx.isWorkday ? 240 : 420;
    const overloaded = load[d] > cap;
    if (overloaded) warnings.push(`${ctx.dayStart.toFormat('cccc')} is overloaded (${Math.round(load[d] / 60 * 10) / 10}h of tasks outside work).`);
    return {
      date: d,
      label: ctx.dayStart.toFormat('cccc'),
      is_workday: ctx.isWorkday,
      existing: ctx.busy.filter((b) => b.type === 'task').map((b) => ({ task_id: b.task.id, title: b.task.title, start_at: new Date(b.task.start_at).toISOString(), end_at: new Date(b.task.end_at).toISOString() })),
      proposed: placements[d].sort((a, b) => a.start_at.localeCompare(b.start_at)),
      load_minutes: load[d],
      capacity_minutes: cap,
      overloaded,
    };
  });
  return { timezone: tz, days, warnings };
}

module.exports = { loadDays, suggest, planDay, planWeek, freeMinutesRemaining, timelineFor, preferredWindow, earliestFor };
