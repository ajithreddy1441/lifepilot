const { query, one } = require('../../config/db');
const { toJson, parseJson } = require('../../utils/json');
const { DateTime, inZone, local, humanDate, humanTime, todayIn, dayBoundsUtc, timeToMinutes } = require('../../utils/time');
const { getUser, getPreferences, resolveCategory } = require('../../models/userModel');
const { parsedAction } = require('./actionSchema');
const rules = require('./intentParser');
const llm = require('./llmClient');
const executor = require('./actionExecutor');
const taskService = require('../tasks/taskService');
const alarmService = require('../alarms/alarmService');
const engine = require('../scheduler/schedulingEngine');
const { nextOccurrence } = require('../alarms/recurrence');
const M = require('../scheduler/slotMath');

const SYSTEM_PROMPT = `You are LifePilot, a practical personal scheduling assistant. Convert the user's message into ONE JSON object.
Never invent a date or time the user didn't imply: use null. Resolve relative dates ("tomorrow", "Saturday") to YYYY-MM-DD using the provided current date.
Times are 24h "HH:mm" in the user's timezone. Interpret ambiguous times sensibly (e.g. "workout at 6:40" = 06:40, "freelance at 7" = 19:00).
Schema:
{"intent": one of CREATE_TASK|CREATE_ALARM|CREATE_REMINDER|UPDATE_TASK|RESCHEDULE|CANCEL_TASK|COMPLETE_TASK|QUERY_SCHEDULE|QUERY_ALARMS|PLAN_DAY|PLAN_WEEK|SUGGEST_TIME|CONFIRM|REJECT|UNKNOWN,
 "task_title": short title for new items, "target": title words of an EXISTING task/alarm being changed,
 "category": job|freelancing|personal|fitness|creative|learning|home|goals|null,
 "date","time","time_of_day": morning|afternoon|evening|night|null, "duration_minutes", "reminder_minutes",
 "repeat": {"type": daily|weekly|selected_days|custom, "days": ["MON",...], "interval": n}|null,
 "new_date","new_time","new_time_of_day" (for moves), "shift_minutes", "is_alarm", "hard_delete",
 "requests": [{"title","category","sessions","duration_minutes"}] (PLAN_WEEK workload), "week": this|next,
 "reply": one short sentence ONLY for UNKNOWN/small talk}
Rules: "remind me ..." with a time = CREATE_REMINDER. "set an alarm"/"wake me" = CREATE_ALARM. "I can't X ..." = RESCHEDULE.
"move/shift X to Y" = UPDATE_TASK. "when should I ..." = SUGGEST_TIME. "yes/ok/confirm" = CONFIRM. Output JSON only.`;

async function interpret(text, user, prefs) {
  const ruleAction = rules.parse(text, { tz: user.timezone, prefs });
  if (!llm.isConfigured() || ['CONFIRM', 'REJECT'].includes(ruleAction.intent)) {
    return { action: parsedAction.parse(ruleAction), parser: 'rules' };
  }
  try {
    const now = DateTime.now().setZone(user.timezone);
    const raw = await llm.chat(
      [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Now: ${now.toFormat("cccc yyyy-MM-dd HH:mm")} (${user.timezone}). Wake ${prefs.wake_time}, sleep ${prefs.sleep_time}, work ${prefs.work_start}-${prefs.work_end} on ${prefs.work_days.join(',')}.\nMessage: ${text}`,
        },
      ],
      { json: true },
    );
    const checked = parsedAction.safeParse(raw);
    if (checked.success && checked.data.intent !== 'UNKNOWN') return { action: checked.data, parser: 'llm' };
    if (checked.success && ruleAction.intent === 'UNKNOWN') return { action: checked.data, parser: 'llm' };
  } catch (err) {
    console.warn('[ai] LLM parse failed, using rules:', err.message);
  }
  return { action: parsedAction.parse(ruleAction), parser: 'rules' };
}

const rangeLabel = (start, end, tz) => `${humanTime(start, tz)}${end ? `–${humanTime(end, tz)}` : ''}`;
const minutesLabel = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m} min`);
const repeatLabel = (r) => {
  if (!r) return null;
  if (r.type === 'daily') return 'Every day';
  if (r.type === 'custom') return `Every ${r.interval} days`;
  return r.days.map((d) => d[0] + d.slice(1).toLowerCase()).join(' / ') || 'Weekly';
};

async function categoryFor(userId, slug, title) {
  const s = slug || rules.detectCategory(title || '');
  return s ? resolveCategory(userId, s) : null;
}

function windowStartMinute(tod, prefs) {
  if (!tod) return null;
  const w = M.windowFor(tod, prefs);
  return w ? w[0] : null;
}

// ---------------------------------------------------------------- handlers -> { reply, proposal?, data? }

async function handleCreate(userId, a, ctx) {
  const { tz, prefs } = ctx;
  const title = a.task_title || 'Task';
  const cat = await categoryFor(userId, a.category, title);
  const slug = cat?.slug || null;
  const duration = a.duration_minutes || rules.DEFAULT_DURATION[slug] || 30;
  const isAlarm = a.intent === 'CREATE_ALARM';
  const isReminder = a.intent === 'CREATE_REMINDER';

  // Repeating reminders/alarms become a recurring alarm; the phone rings on each occurrence.
  if (isAlarm || (a.repeat && isReminder)) {
    if (!a.time) return { reply: `What time should the ${isAlarm ? 'alarm' : 'reminder'} for "${title}" be?` };
    const today = todayIn(tz);
    let date = a.date || today;
    if (!a.repeat && local(date, a.time, tz) <= DateTime.now().setZone(tz)) date = DateTime.fromISO(date).plus({ days: 1 }).toISODate();
    const repeatType = a.repeat ? (a.repeat.type === 'weekly' && a.repeat.days.length > 1 ? 'selected_days' : a.repeat.type) : 'once';
    const alarm = {
      title,
      alarm_date: date,
      alarm_time: a.time,
      timezone: tz,
      repeat_type: repeatType,
      repeat_days: a.repeat?.days?.length ? a.repeat.days : null,
      repeat_interval_days: a.repeat?.interval || null,
      duration_minutes: a.duration_minutes || (slug ? duration : null),
      reminder_minutes: a.reminder_minutes ?? (/wake/i.test(title) ? 0 : prefs.default_reminder_minutes),
      category_id: cat?.id || null,
      sound: isAlarm ? prefs.default_alarm_sound : 'default',
    };
    const first = nextOccurrence({ ...alarm, repeat_days: alarm.repeat_days?.join(',') });
    const fields = [
      { label: 'Alarm', value: title },
      { label: 'Time', value: alarm.duration_minutes ? rangeLabel(first, new Date(first.getTime() + alarm.duration_minutes * 60000), tz) : humanTime(first, tz) },
      { label: a.repeat ? 'Repeat' : 'Date', value: a.repeat ? repeatLabel(a.repeat) : humanDate(first, tz) },
      { label: 'Reminder', value: alarm.reminder_minutes ? `${alarm.reminder_minutes} minutes before` : 'Off' },
      { label: 'Phone alarm', value: 'Enabled' },
    ];
    return {
      reply: `${title} — ${a.repeat ? repeatLabel(a.repeat).toLowerCase() : humanDate(first, tz).toLowerCase()} at ${humanTime(first, tz)}. Confirm?`,
      proposal: { intent: 'CREATE_ALARM', payload: { alarm }, preview: { kind: 'alarm', title, fields, warnings: [] } },
    };
  }

  const base = { title, category_id: cat?.id || null, duration_minutes: duration, priority: 'medium', source: ctx.mode === 'voice' ? 'voice' : 'ai' };
  if (isReminder) {
    base.alarm_enabled = true;
    base.reminder_minutes = a.reminder_minutes ?? prefs.default_reminder_minutes;
  } else {
    base.reminder_minutes = a.reminder_minutes ?? prefs.default_reminder_minutes;
  }
  const taskPreview = (start, extra = {}) => {
    const end = new Date(new Date(start).getTime() + duration * 60000);
    return [
      { label: 'Task', value: title },
      { label: 'Date', value: humanDate(start, tz) },
      { label: 'Time', value: rangeLabel(start, end, tz) },
      ...(cat ? [{ label: 'Category', value: `${cat.icon} ${cat.name}` }] : []),
      { label: 'Reminder', value: base.reminder_minutes ? `${base.reminder_minutes} minutes before` : 'At start' },
      { label: 'Phone alarm', value: base.alarm_enabled ? 'Enabled' : 'Off' },
      ...(a.repeat ? [{ label: 'Repeat', value: repeatLabel(a.repeat) }] : []),
      ...(extra.fields || []),
    ];
  };

  if (a.time) {
    const date = a.date || todayIn(tz);
    const start = local(date, a.time, tz).toUTC().toJSDate();
    if (start <= new Date() && !a.repeat) {
      return { reply: `${humanTime(start, tz)} ${humanDate(start, tz).toLowerCase()} has already passed. Did you mean tomorrow?` };
    }
    const end = new Date(start.getTime() + duration * 60000);
    const { conflicts, warnings } = await taskService.findConflicts(userId, start, end);
    if (conflicts.length) {
      const s = await engine.suggest(userId, { title, category_slug: slug, category_id: cat?.id, duration, date, anchorMinute: timeToMinutes(a.time) });
      if (!s.best) return { reply: `That overlaps "${conflicts[0].title}" and I couldn't find another free slot that day.` };
      return {
        reply: `That overlaps "${conflicts[0].title}". The nearest free slot is ${s.best.label}. Use that instead?`,
        proposal: {
          intent: 'CREATE_TASK',
          payload: { task: { ...base, start_at: s.best.start_at }, repeat: a.repeat, alternatives: s.alternatives.map((x) => x.start_at) },
          preview: { kind: 'task', title, fields: taskPreview(s.best.start_at), warnings: [`Original time overlaps "${conflicts[0].title}".`], alternatives: s.alternatives },
        },
      };
    }
    return {
      reply: `${title} — ${humanDate(start, tz).toLowerCase()} ${rangeLabel(start, end, tz)}${base.alarm_enabled ? ', phone alarm on' : ''}. Confirm?`,
      proposal: {
        intent: 'CREATE_TASK',
        payload: { task: { ...base, start_at: start.toISOString() }, repeat: a.repeat },
        preview: { kind: 'task', title, fields: taskPreview(start), warnings },
      },
    };
  }

  // No time given: protect sleep for long blocks, otherwise let the engine pick.
  const date = a.date || null;
  if (date && duration > 90) {
    const from = windowStartMinute(a.time_of_day, prefs);
    const { free, ctx: dayCtx } = await engine.freeMinutesRemaining(userId, date, from !== null ? Math.max(from, engine.earliestFor(dayCtx0(date, tz))) : null, slug);
    const longest = free.reduce((m, [s, e]) => Math.max(m, e - s), 0);
    if (longest < duration) {
      const tonight = Math.floor(longest / 30) * 30;
      const rest = duration - tonight;
      const nextDate = DateTime.fromISO(date).plus({ days: 1 }).toISODate();
      const later = await engine.suggest(userId, { title, category_slug: slug, category_id: cat?.id, duration: rest, date: nextDate });
      const firstSlot = tonight >= 30 ? free.find(([s, e]) => e - s >= tonight) : null;
      const items = [];
      if (firstSlot) items.push({ ...base, title, duration_minutes: tonight, start_at: dayCtx.dayStart.plus({ minutes: M.roundUp(firstSlot[0]) }).toUTC().toISO() });
      if (later.best) items.push({ ...base, title, duration_minutes: rest, start_at: later.best.start_at });
      const when = a.time_of_day === 'night' || a.time_of_day === 'evening' ? 'tonight' : humanDate(local(date, '12:00', tz).toJSDate(), tz).toLowerCase();
      if (!items.length) return { reply: `There isn't enough free time ${when} before your ${prefs.sleep_time} sleep time. Want me to look at another day?` };
      return {
        reply: `You only have about ${minutesLabel(tonight)} available ${when} before your preferred sleep time. I recommend ${minutesLabel(tonight)} ${when} and ${minutesLabel(rest)} ${later.best ? humanDate(later.best.start_at, tz).toLowerCase() : 'later'}. Shall I schedule that?`,
        proposal: {
          intent: 'CREATE_TASKS',
          payload: { tasks: items },
          preview: {
            kind: 'tasks',
            title: `${title} split`,
            items: items.map((t) => ({ title: t.title, start_at: t.start_at, end_at: new Date(new Date(t.start_at).getTime() + t.duration_minutes * 60000).toISOString(), duration_minutes: t.duration_minutes })),
            warnings: ['Split to protect your sleep time.'],
          },
        },
      };
    }
  }

  const s = await engine.suggest(userId, { title, category_slug: slug, category_id: cat?.id, duration, date, preferred: a.time_of_day || undefined });
  if (!s.best) return { reply: `I couldn't find a free ${minutesLabel(duration)} slot${date ? ` on ${humanDate(local(date, '12:00', tz).toJSDate(), tz)}` : ' this week'}. Try a shorter duration or another day.` };
  return {
    reply: `I recommend ${s.best.reason}`,
    proposal: {
      intent: 'CREATE_TASK',
      payload: { task: { ...base, start_at: s.best.start_at }, repeat: a.repeat, alternatives: s.alternatives.map((x) => x.start_at) },
      preview: { kind: 'task', title, fields: taskPreview(s.best.start_at), reason: s.best.reason, alternatives: s.alternatives, warnings: [] },
    },
  };
}

function dayCtx0(date, tz) {
  return { dayStart: DateTime.fromISO(date, { zone: tz }).startOf('day'), tz };
}

async function findTask(userId, a, tz) {
  if (a.task_id) return taskService.get(userId, a.task_id);
  const opts = {};
  if (a.date) {
    const b = dayBoundsUtc(a.date, tz);
    opts.from = b.start;
    opts.to = b.end;
    opts.around = b.start;
  } else {
    opts.from = new Date(Date.now() - 12 * 3600000);
  }
  let matches = await taskService.findByTitle(userId, a.target || a.task_title || '', opts);
  if (a.date && a.time_of_day && matches.length > 1) {
    const w = matches.filter((t) => t.start_at && M.partOfDay(inZone(t.start_at, tz).hour * 60) === a.time_of_day);
    if (w.length) matches = w;
  }
  return matches[0] || null;
}

function moveProposal(task, startIso, tz, { reason, warnings = [], alternatives = [] } = {}) {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + task.duration_minutes * 60000);
  const w = [...warnings];
  if (task.due_at && end > new Date(task.due_at)) w.push(`This moves it past its deadline (${humanDate(task.due_at, tz)} ${humanTime(task.due_at, tz)}).`);
  if (task.is_critical_deadline) w.push('This task is marked as a critical deadline.');
  return {
    intent: 'MOVE_TASK',
    payload: { task_id: task.id, start_at: start.toISOString(), duration_minutes: task.duration_minutes, alternatives: alternatives.map((x) => x.start_at) },
    preview: {
      kind: 'move',
      title: task.title,
      from: task.start_at ? `${humanDate(task.start_at, tz)} ${rangeLabel(task.start_at, task.end_at, tz)}` : 'Unscheduled',
      to: `${humanDate(start, tz)} ${rangeLabel(start, end, tz)}`,
      fields: [
        { label: 'Task', value: task.title },
        { label: 'New time', value: `${humanDate(start, tz)}, ${rangeLabel(start, end, tz)}` },
        { label: 'Phone alarm', value: task.alarm_enabled ? 'Will be moved' : 'Off' },
      ],
      reason,
      alternatives,
      warnings: w,
    },
  };
}

async function handleMove(userId, a, ctx) {
  const { tz } = ctx;
  const task = await findTask(userId, a, tz);
  if (!task) return { reply: `I couldn't find "${a.target || 'that task'}"${a.date ? ` on ${humanDate(local(a.date, '12:00', tz).toJSDate(), tz).toLowerCase()}` : ''}.` };
  const cur = task.start_at ? inZone(task.start_at, tz) : DateTime.now().setZone(tz);
  const date = a.new_date || cur.toISODate();

  let startIso = null;
  if (a.shift_minutes) startIso = cur.plus({ minutes: a.shift_minutes }).toUTC().toISO();
  else if (a.new_time) startIso = local(date, a.new_time, tz).toUTC().toISO();
  else if (a.new_date && task.start_at) startIso = local(date, cur.toFormat('HH:mm'), tz).toUTC().toISO();

  if (startIso) {
    if (new Date(startIso) <= new Date()) return { reply: 'That time has already passed. Pick a later time?' };
    const end = new Date(new Date(startIso).getTime() + task.duration_minutes * 60000);
    const { conflicts, warnings } = await taskService.findConflicts(userId, new Date(startIso), end, task.id);
    if (!conflicts.length) {
      return { reply: `Move ${task.title} to ${humanDate(startIso, tz).toLowerCase()} ${rangeLabel(startIso, end, tz)}?`, proposal: moveProposal(task, startIso, tz, { warnings }) };
    }
    const s = await engine.suggest(userId, { title: task.title, category_slug: task.category_slug, duration: task.duration_minutes, date, excludeTaskId: task.id, anchorMinute: inZone(startIso, tz).hour * 60 + inZone(startIso, tz).minute });
    if (!s.best) return { reply: `That overlaps "${conflicts[0].title}" and I couldn't find another slot that day.` };
    return {
      reply: `That overlaps "${conflicts[0].title}". The closest free slot is ${s.best.label}. Move it there?`,
      proposal: moveProposal(task, s.best.start_at, tz, { reason: s.best.reason, alternatives: s.alternatives }),
    };
  }

  // No explicit target time: find the next good slot (after the original on that day, or on the new day).
  const after = a.new_date ? null : task.end_at;
  const preferred = a.new_time_of_day || (a.time_of_day === 'morning' ? 'evening' : undefined);
  const s = await engine.suggest(userId, { title: task.title, category_slug: task.category_slug, duration: task.duration_minutes, date, excludeTaskId: task.id, after, preferred });
  if (!s.best) return { reply: `I couldn't find a free slot for ${task.title} on ${humanDate(local(date, '12:00', tz).toJSDate(), tz).toLowerCase()}.` };
  const sameDay = inZone(s.best.start_at, tz).toISODate() === date;
  return {
    reply: `You have a free slot ${humanDate(s.best.start_at, tz).toLowerCase()} at ${humanTime(s.best.start_at, tz)}${sameDay ? '' : ' (that day is full)'}. Would you like me to move your ${task.title.toLowerCase()} there?`,
    proposal: moveProposal(task, s.best.start_at, tz, { reason: s.best.reason, alternatives: s.alternatives }),
  };
}

async function handleCancel(userId, a, ctx) {
  const { tz } = ctx;
  if (a.is_alarm) {
    const alarms = await alarmService.list(userId);
    const words = (a.target || '').toLowerCase().replace(/\balarms?\b/g, '').trim();
    const alarm = alarms.find((x) => words && x.title.toLowerCase().includes(words)) || (alarms.length === 1 ? alarms[0] : null);
    if (!alarm) return { reply: `Which alarm? You have: ${alarms.map((x) => `${x.title} (${x.alarm_time})`).join(', ') || 'none'}.` };
    return {
      reply: `Delete the "${alarm.title}" alarm (${alarm.alarm_time}, ${alarm.repeat_label})? It will also be removed from your phone.`,
      proposal: { intent: 'DELETE_ALARM', payload: { alarm_id: alarm.id }, preview: { kind: 'cancel', title: alarm.title, fields: [{ label: 'Alarm', value: `${alarm.title} · ${alarm.alarm_time}` }, { label: 'Repeat', value: alarm.repeat_label }], warnings: ['This removes the alarm from all devices.'] } },
    };
  }
  const task = await findTask(userId, a, tz);
  if (!task) return { reply: `I couldn't find "${a.target || 'that task'}"${a.date ? ` on ${humanDate(local(a.date, '12:00', tz).toJSDate(), tz).toLowerCase()}` : ''}.` };
  const when = task.start_at ? `${humanDate(task.start_at, tz).toLowerCase()} at ${humanTime(task.start_at, tz)}` : 'unscheduled';
  const warnings = [];
  if (task.is_critical_deadline || task.priority === 'critical') warnings.push('This is a critical task.');
  if (task.alarm_enabled) warnings.push('Its phone alarm will be cancelled.');
  return {
    reply: `${a.hard_delete ? 'Delete' : 'Cancel'} ${task.title} (${when})?`,
    proposal: {
      intent: 'CANCEL_TASK',
      payload: { task_id: task.id, hard_delete: !!a.hard_delete },
      preview: { kind: 'cancel', title: task.title, fields: [{ label: 'Task', value: task.title }, { label: 'When', value: when }], warnings },
    },
  };
}

async function handleQuerySchedule(userId, a, { tz }) {
  if (a.next) {
    const day = await require('../scheduler/plannerService').getDay(userId);
    const t = day.next_up;
    return { reply: t ? `Next up: ${t.title} at ${humanTime(t.start_at, tz)}${t.alarm_id ? ' (alarm on)' : ''}.` : 'Nothing else scheduled today.', data: { next_up: t } };
  }
  const date = a.date || todayIn(tz);
  const b = dayBoundsUtc(date, tz);
  const tasks = await taskService.list(userId, { from: b.start, to: b.end, status: 'pending,in_progress,completed' });
  const timed = tasks.filter((t) => t.start_at);
  const label = humanDate(b.start, tz).toLowerCase();
  if (!timed.length) return { reply: `Nothing scheduled ${label === 'today' || label === 'tomorrow' ? label : `on ${label}`}. Want me to plan it?`, data: { tasks: [] } };
  const lines = timed.map((t) => `${inZone(t.start_at, tz).toFormat('HH:mm')} ${t.title}${t.status === 'completed' ? ' ✓' : ''}`);
  return { reply: `${label[0].toUpperCase() + label.slice(1)}:\n${lines.join('\n')}`, data: { tasks: timed } };
}

async function handleQueryAlarms(userId, a, { tz }) {
  const alarms = (await alarmService.list(userId)).filter((x) => x.enabled);
  let rows = alarms.map((x) => ({ x, at: x.next_trigger_at ? new Date(x.next_trigger_at) : null }));
  let label = 'coming up';
  if (a.date) {
    const b = dayBoundsUtc(a.date, tz);
    rows = alarms.map((x) => ({ x, at: nextOccurrence({ ...x, repeat_days: x.repeat_days.join(',') }, new Date(b.start.getTime() - 1000)) })).filter((r) => r.at && r.at < b.end);
    label = humanDate(b.start, tz).toLowerCase();
  }
  rows = rows.filter((r) => r.at).sort((p, q) => p.at - q.at);
  if (!rows.length) return { reply: `No alarms ${a.date ? label : 'set'}.`, data: { alarms: [] } };
  return {
    reply: `Alarms ${label}:\n${rows.map((r) => `${humanTime(r.at, tz)} ${r.x.title}${a.date ? '' : ` (${r.x.repeat_label})`}`).join('\n')}`,
    data: { alarms: rows.map((r) => ({ ...r.x, at: r.at })) },
  };
}

async function handlePlanDay(userId, a, { tz }) {
  const now = DateTime.now().setZone(tz);
  const date = a.date || now.toISODate();
  const plan = await engine.planDay(userId, date);
  let proposed = plan.proposed;
  if (a.time_of_day) {
    const w = M.windowFor(a.time_of_day, await getPreferences(userId));
    proposed = proposed.filter((p) => {
      const m = inZone(p.start_at, tz).diff(DateTime.fromISO(date, { zone: tz }).startOf('day'), 'minutes').minutes;
      return w && m >= w[0] && m < w[1];
    });
  }
  const dayLabel = humanDate(local(date, '12:00', tz).toJSDate(), tz).toLowerCase();
  if (!proposed.length) {
    return {
      reply: `Your ${a.time_of_day || 'day'} ${dayLabel} has nothing unscheduled to place. Here's what's already planned.`,
      data: { timeline: plan.timeline, warnings: plan.warnings },
    };
  }
  return {
    reply: `Here's a plan for ${a.time_of_day ? `${dayLabel}'s ${a.time_of_day}` : dayLabel}: ${proposed.length} item${proposed.length > 1 ? 's' : ''} fitted around your fixed schedule.${plan.warnings.length ? ` ${plan.warnings[0]}` : ''} Accept?`,
    proposal: {
      intent: 'APPLY_PLAN',
      payload: { items: proposed },
      preview: { kind: 'plan_day', title: `Plan for ${dayLabel}`, date, timeline: plan.timeline, items: proposed, warnings: plan.warnings },
    },
  };
}

async function handlePlanWeek(userId, a, { tz }) {
  const requests = [];
  for (const r of a.requests || []) {
    const cat = await categoryFor(userId, r.category, r.title);
    requests.push({ title: r.title, category_slug: cat?.slug || null, category_id: cat?.id || null, sessions: r.sessions, duration_minutes: r.duration_minutes });
  }
  const start = a.week === 'next' ? DateTime.now().setZone(tz).startOf('week').plus({ weeks: 1 }).toISODate() : null;
  const plan = await engine.planWeek(userId, { start, requests });
  const items = plan.days.flatMap((d) => d.proposed);
  if (!items.length) {
    return { reply: "Nothing new to place this week. Tell me what you need to get done, e.g. \"workout 4 times and study React 3 hours\".", data: plan };
  }
  return {
    reply: `Here's a proposed week with ${items.length} sessions.${plan.warnings.length ? ` Heads up: ${plan.warnings[0]}` : ' The load looks balanced.'} Accept?`,
    proposal: { intent: 'APPLY_PLAN', payload: { items }, preview: { kind: 'plan_week', title: 'Weekly plan', days: plan.days, warnings: plan.warnings } },
  };
}

async function handleSuggest(userId, a, ctx) {
  const { tz } = ctx;
  const existing = a.task_id
    ? await taskService.get(userId, a.task_id)
    : (await taskService.findByTitle(userId, a.target || a.task_title || '', {})).find((t) => !t.start_at || new Date(t.start_at) > new Date());
  const title = existing?.title || a.task_title || 'Task';
  const cat = existing ? { id: existing.category_id, slug: existing.category_slug } : await categoryFor(userId, a.category, title);
  const duration = a.duration_minutes || existing?.duration_minutes || rules.DEFAULT_DURATION[cat?.slug] || 30;
  const s = await engine.suggest(userId, { title, category_slug: cat?.slug, category_id: cat?.id, duration, date: a.date, deadline: existing?.due_at, preferred: a.time_of_day || undefined, excludeTaskId: existing?.id });
  if (!s.best) return { reply: `I couldn't find a free ${minutesLabel(duration)} slot soon. Want to try a shorter session?` };
  const because = s.best.reason.slice(s.best.reason.indexOf('because'));
  const reply = `${humanDate(s.best.start_at, tz)} ${humanTime(s.best.start_at, tz)} is a good option ${because}`;
  if (existing) {
    return { reply: `${reply} Schedule it?`, proposal: moveProposal(existing, s.best.start_at, tz, { reason: s.best.reason, alternatives: s.alternatives }) };
  }
  const base = { title, category_id: cat?.id || null, duration_minutes: duration, reminder_minutes: ctx.prefs.default_reminder_minutes, source: 'ai' };
  return {
    reply: `${reply} Schedule it?`,
    proposal: {
      intent: 'CREATE_TASK',
      payload: { task: { ...base, start_at: s.best.start_at }, alternatives: s.alternatives.map((x) => x.start_at) },
      preview: {
        kind: 'task',
        title,
        fields: [{ label: 'Task', value: title }, { label: 'When', value: s.best.label }, { label: 'Duration', value: minutesLabel(duration) }],
        reason: s.best.reason,
        alternatives: s.alternatives,
        warnings: [],
      },
    },
  };
}

async function handleComplete(userId, a, { tz }) {
  const task = await findTask(userId, { ...a, date: null }, tz);
  if (!task) return { reply: `I couldn't find "${a.target}".` };
  await taskService.complete(userId, task.id);
  return { reply: `Marked ${task.title} as done ✓`, executed: { intent: 'COMPLETE_TASK', payload: { task_id: task.id } } };
}

const HELP = 'I can add tasks and alarms, move or cancel them, and plan your day or week. Try: "Remind me tomorrow at 6:40 to workout", "Move my workout to 7 PM", or "Plan my day".';

// ---------------------------------------------------------------- orchestration

async function saveMessage(userId, role, content, mode = 'text', actionId = null) {
  await query('INSERT INTO ai_conversations (user_id, role, content, input_mode, action_id) VALUES (?, ?, ?, ?, ?)', [userId, role, content.slice(0, 4000), mode, actionId]);
}

async function storeProposal(userId, proposal, parser) {
  // A newer proposal supersedes older unconfirmed ones so "yes" always refers to the latest.
  await query("UPDATE ai_actions SET status = 'expired' WHERE user_id = ? AND status = 'proposed'", [userId]);
  const start = proposal.payload.task?.start_at || proposal.payload.start_at;
  if (start && !proposal.preview.start_at) {
    const mins = proposal.payload.task?.duration_minutes || proposal.payload.duration_minutes || 30;
    proposal.preview.start_at = new Date(start).toISOString();
    proposal.preview.end_at = new Date(new Date(start).getTime() + mins * 60000).toISOString();
  }
  const res = await query('INSERT INTO ai_actions (user_id, intent, payload, preview, parser) VALUES (?, ?, ?, ?, ?)', [userId, proposal.intent, toJson(proposal.payload), toJson(proposal.preview), parser]);
  return { id: res.insertId, intent: proposal.intent, preview: proposal.preview, status: 'proposed' };
}

async function route(userId, action, ctx) {
  switch (action.intent) {
    case 'CREATE_TASK':
    case 'CREATE_ALARM':
    case 'CREATE_REMINDER':
      return handleCreate(userId, action, ctx);
    case 'UPDATE_TASK':
    case 'RESCHEDULE':
      return handleMove(userId, action, ctx);
    case 'CANCEL_TASK':
      return handleCancel(userId, action, ctx);
    case 'COMPLETE_TASK':
      return handleComplete(userId, action, ctx);
    case 'QUERY_SCHEDULE':
      return handleQuerySchedule(userId, action, ctx);
    case 'QUERY_ALARMS':
      return handleQueryAlarms(userId, action, ctx);
    case 'PLAN_DAY':
      return handlePlanDay(userId, action, ctx);
    case 'PLAN_WEEK':
      return handlePlanWeek(userId, action, ctx);
    case 'SUGGEST_TIME':
      return handleSuggest(userId, action, ctx);
    default:
      return { reply: action.reply || HELP };
  }
}

async function confirmLatest(userId) {
  const pending = await one("SELECT * FROM ai_actions WHERE user_id = ? AND status = 'proposed' AND created_at > UTC_TIMESTAMP() - INTERVAL 30 MINUTE ORDER BY id DESC LIMIT 1", [userId]);
  if (!pending) return { reply: "There's nothing waiting for confirmation." };
  const out = await executor.execute(userId, pending);
  return { reply: out.summary, executedAction: { id: pending.id, intent: pending.intent, status: out.ok ? 'executed' : 'failed', result: out.result } };
}

async function handleMessage(userId, text, mode = 'text') {
  const [user, prefs] = await Promise.all([getUser(userId), getPreferences(userId)]);
  const ctx = { tz: user.timezone, prefs, mode };
  await saveMessage(userId, 'user', text, mode);
  const { action, parser } = await interpret(text, user, prefs);

  let out;
  let actionOut = null;
  if (action.intent === 'CONFIRM') {
    out = await confirmLatest(userId);
    actionOut = out.executedAction || null;
  } else if (action.intent === 'REJECT') {
    const r = await query("UPDATE ai_actions SET status = 'rejected' WHERE user_id = ? AND status = 'proposed'", [userId]);
    out = { reply: r.affectedRows ? "Okay, I won't change anything." : 'Okay.' };
  } else {
    out = await route(userId, action, ctx);
    if (out.proposal) actionOut = await storeProposal(userId, out.proposal, parser);
    if (out.executed) {
      await query("INSERT INTO ai_actions (user_id, intent, payload, status, parser, executed_at) VALUES (?, ?, ?, 'executed', ?, UTC_TIMESTAMP())", [userId, out.executed.intent, toJson(out.executed.payload), parser]);
    }
  }
  await saveMessage(userId, 'assistant', out.reply, 'text', actionOut?.id || null);
  return { reply: out.reply, action: actionOut, data: out.data || null, intent: action.intent, parsed: action, parser };
}

/** Direct entry points used by the planner/suggest endpoints (same validation + proposal pipeline). */
async function runIntent(userId, action) {
  const [user, prefs] = await Promise.all([getUser(userId), getPreferences(userId)]);
  const parsed = parsedAction.parse(action);
  const out = await route(userId, parsed, { tz: user.timezone, prefs, mode: 'text' });
  const actionOut = out.proposal ? await storeProposal(userId, out.proposal, 'direct') : null;
  return { reply: out.reply, action: actionOut, data: out.data || null };
}

async function history(userId, limit = 50) {
  const rows = await query(
    `SELECT c.id, c.role, c.content, c.input_mode, c.created_at, a.id AS action_id, a.intent, a.status AS action_status, a.preview
     FROM ai_conversations c LEFT JOIN ai_actions a ON a.id = c.action_id
     WHERE c.user_id = ? ORDER BY c.id DESC LIMIT ?`,
    [userId, limit],
  );
  return rows.reverse().map((r) => ({
    id: r.id,
    role: r.role,
    content: r.content,
    input_mode: r.input_mode,
    created_at: r.created_at,
    action: r.action_id ? { id: r.action_id, intent: r.intent, status: r.action_status, preview: parseJson(r.preview) } : null,
  }));
}

module.exports = { handleMessage, runIntent, history, interpret };
