// Deterministic natural-language parser. Used when no LLM key is configured and as a fallback when the
// LLM response fails validation. Produces the same structured action shape as the LLM path.
const chrono = require('chrono-node');
const { DateTime } = require('luxon');
const { timeToMinutes, DAY_CODES } = require('../../utils/time');

const NUMBER_WORDS = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, once: 1, twice: 2, half: 0.5, couple: 2 };
const NUM = '(\\d+(?:\\.\\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half an?|a couple of)';
const toNumber = (w) => {
  if (!w) return null;
  const s = String(w).toLowerCase().replace(/ of$/, '').trim();
  if (/^half/.test(s)) return 0.5;
  if (s === 'a couple') return 2;
  return Number.isNaN(Number(s)) ? NUMBER_WORDS[s] ?? null : Number(s);
};

const CATEGORY_KEYWORDS = [
  ['fitness', /\b(work ?outs?|gym|runs?|running|jog|walks?|walking|yoga|exercises?|training|cardio|swim|stretch|lift|push-?ups?|fitness)\b/],
  ['freelancing', /\b(freelanc\w*|clients?|upwork|fiverr|websites?|landing pages?|invoices?)\b/],
  ['creative', /\b(write|writing|story|stories|akr|blogs?|poems?|draw|drawing|design|videos?|scripts?|novel|chapters?)\b/],
  ['learning', /\b(study|learn|learning|react|courses?|tutorials?|practice|read docs|lessons?|exams?|revise)\b/],
  ['job', /\b(meetings?|office|standup|stand-up|main job|work tasks?|manager|reports?|presentations?)\b/],
  ['home', /\b(clean|cleaning|laundry|grocer\w*|cook|cooking|dishes|home|bills?|shopping)\b/],
  ['personal', /\b(call|mom|dad|family|doctor|dentist|friends?|birthday|dinner|lunch|breakfast|medicine|pills?)\b/],
  ['goals', /\b(goals?|planning|plan|review)\b/],
];

const DEFAULT_DURATION = { fitness: 40, creative: 45, learning: 60, freelancing: 90, job: 60, home: 30, personal: 30, goals: 30 };

function detectCategory(text) {
  const t = text.toLowerCase();
  for (const [slug, re] of CATEGORY_KEYWORDS) if (re.test(t)) return slug;
  return null;
}

function extractDuration(text) {
  const re = new RegExp(`\\b(?:for\\s+)?${NUM}\\s+(hours?|hrs?|minutes?|mins?)\\b(?:\\s+and\\s+${NUM}\\s+(minutes?|mins?))?`, 'i');
  const compact = text.match(/\b(?:for\s+)?(\d+(?:\.\d+)?)(h|hrs?|m|mins?)\b/i);
  if (compact && !/\d:\d/.test(compact[0])) {
    const n = Number(compact[1]);
    return { minutes: Math.round(/^h/i.test(compact[2]) ? n * 60 : n), text: text.replace(compact[0], ' ') };
  }
  const m = text.match(re);
  if (!m) {
    const half = text.match(/\b(?:for\s+)?(half an hour|an hour and a half|an hour)\b/i);
    if (half) {
      const mins = /half an hour/i.test(half[1]) ? 30 : /and a half/i.test(half[1]) ? 90 : 60;
      return { minutes: mins, text: text.replace(half[0], ' ') };
    }
    return { minutes: null, text };
  }
  // "at 7 m" style false positives are unlikely; require the unit to be a real duration word.
  const n = toNumber(m[1]);
  let minutes = /^h/i.test(m[2]) ? n * 60 : n;
  if (m[3]) minutes += toNumber(m[3]) || 0;
  return { minutes: Math.round(minutes), text: text.replace(m[0], ' ') };
}

function extractReminder(text) {
  const m = text.match(new RegExp(`\\b${NUM}\\s+(minutes?|mins?|hours?|hrs?)\\s+(before|early|earlier|prior)\\b`, 'i'));
  if (!m) return { minutes: null, text };
  const n = toNumber(m[1]);
  return { minutes: Math.round(/^h/i.test(m[2]) ? n * 60 : n), text: text.replace(m[0], ' ') };
}

const DAY_RE = { MON: 'mon(day)?s?', TUE: 'tue(s|sday)?s?', WED: 'wed(nesday)?s?', THU: 'thu(r|rs|rsday)?s?', FRI: 'fri(day)?s?', SAT: 'sat(urday)?s?', SUN: 'sun(day)?s?' };

function extractRepeat(text) {
  let t = text;
  if (/\b(every ?day|daily|each day|every morning|every evening|every night)\b/i.test(t)) {
    return { repeat: { type: 'daily', days: [] }, text: t.replace(/\b(every ?day|daily|each day)\b/i, ' ').replace(/\bevery (morning|evening|night)\b/i, '$1') };
  }
  if (/\b(every )?weekdays?\b/i.test(t)) return { repeat: { type: 'selected_days', days: ['MON', 'TUE', 'WED', 'THU', 'FRI'] }, text: t.replace(/\b(on )?(every )?weekdays?\b/i, ' ') };
  if (/\b(every )?weekends?\b/i.test(t) && /\b(every|on)\b/i.test(t)) return { repeat: { type: 'selected_days', days: ['SAT', 'SUN'] }, text: t.replace(/\b(on )?(every )?weekends?\b/i, ' ') };
  const everyN = t.match(/\bevery (\d+|two|three|four|five|six|seven|ten|fourteen) days\b/i);
  if (everyN) return { repeat: { type: 'custom', days: [], interval: toNumber(everyN[1]) || 2 }, text: t.replace(everyN[0], ' ') };

  const found = [];
  for (const code of DAY_CODES) {
    const re = new RegExp(`\\b${DAY_RE[code]}\\b`, 'i');
    if (re.test(t)) found.push(code);
  }
  const explicitPlural = /\b(mon|tues|wednes|thurs|fri|satur|sun)days\b/i.test(t) || /\bevery\b/i.test(t) || /\//.test(t);
  if (found.length >= 2 || (found.length === 1 && explicitPlural)) {
    for (const code of found) t = t.replace(new RegExp(`\\b${DAY_RE[code]}\\b`, 'ig'), ' ');
    t = t.replace(/\b(every|each|on)\b/gi, ' ').replace(/[/,]|\band\b/gi, ' ');
    return { repeat: { type: found.length === 1 ? 'weekly' : 'selected_days', days: found }, text: t };
  }
  if (/\bevery week\b|\bweekly\b/i.test(t)) return { repeat: { type: 'weekly', days: [] }, text: t.replace(/\bevery week\b|\bweekly\b/i, ' ') };
  return { repeat: null, text: t };
}

function timeOfDay(text) {
  const m = text.toLowerCase().match(/\b(morning|afternoon|evening|tonight|night)\b/);
  if (!m) return null;
  return m[1] === 'tonight' ? 'night' : m[1];
}

/** Run chrono against a "fake local" reference whose server-local fields equal the user's wall clock. */
function parseWhen(text, tz, prefs) {
  const w = DateTime.now().setZone(tz);
  const ref = new Date(w.year, w.month - 1, w.day, w.hour, w.minute, 0);
  const results = chrono.parse(text, ref, { forwardDate: true });
  let date = null;
  let time = null;
  let dayCertain = false;
  const matched = [];
  for (const r of results) {
    const s = r.start;
    const d = s.date();
    matched.push(r.text);
    if (!date && (s.isCertain('day') || s.isCertain('weekday'))) {
      date = DateTime.fromObject({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }).toISODate();
      dayCertain = true;
    }
    if (!time && s.isCertain('hour')) {
      let hour = d.getHours();
      const minute = d.getMinutes();
      // "at 5" with no am/pm before the user's wake time almost certainly means 5 PM.
      if (!s.isCertain('meridiem') && hour < 12 && prefs && hour * 60 + minute < timeToMinutes(prefs.wake_time) && !/\bmorning\b/i.test(text)) hour += 12;
      if (!s.isCertain('meridiem') && hour < 12 && /\b(evening|tonight|night|pm)\b/i.test(text)) hour += 12;
      time = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
      if (!date) {
        date = DateTime.fromObject({ year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() }).toISODate();
      }
    }
  }
  if (date && time && !dayCertain) {
    // Implied date: today if that time is still ahead, otherwise tomorrow.
    const today = w.toISODate();
    const candidate = DateTime.fromISO(`${today}T${time}`, { zone: tz });
    date = candidate > w ? today : w.plus({ days: 1 }).toISODate();
  }
  if (!date && /\btonight\b|\btoday\b|\bthis (evening|afternoon|morning)\b/i.test(text)) date = w.toISODate();
  if (!date && /\btomorrow\b/i.test(text)) date = w.plus({ days: 1 }).toISODate();
  return { date, time, dayCertain, matched };
}

const LEAD = /^(hey|hi|ok(ay)?|please|so|lifepilot|can you|could you|would you|i want you to|i'd like to|i would like to)[,\s]+/i;
const VERBS = /\b(remind me (to|about|that i need to|that)?|remind me|set (up )?(an?|my) (alarm|reminder)( for| to)?|set alarm( for)?|create (an? )?(alarm|reminder|task)( for| to)?|add (an? )?(task|reminder|alarm)?( for| to)?|add|schedule( in)?|book|put|create|i need to|i have to|i want to|i should|i must|wake me up( at)?|alarm for|new task)\b/gi;

function cleanTitle(text, removals = []) {
  let t = ` ${text} `;
  for (const r of removals) if (r) t = t.replace(r, ' ');
  t = t.replace(LEAD, ' ').replace(VERBS, ' ');
  t = t.replace(/\b(today|tomorrow|tonight|this (morning|afternoon|evening|week)|next week|in the (morning|afternoon|evening)|morning|afternoon|evening|night)\b/gi, ' ');
  t = t.replace(/\b(with (an? )?(phone )?alarm|and (set|turn on) (an? )?alarm|phone alarm)\b/gi, ' ');
  t = t.replace(/[.?!]+/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/^(to|for|about|my|a|an|the|at|on|of|that)\s+/i, '').replace(/^(to|for|about|my|a|an|the)\s+/i, '');
  t = t.replace(/\s+(at|on|for|to|by|from|in)$/i, '').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}

const TITLE_ALIASES = { workout: 'Workout', 'work out': 'Workout', gym: 'Workout' };
function normalizeTitle(t) {
  const lower = t.toLowerCase();
  return TITLE_ALIASES[lower] || t;
}

function parsePlanWeekRequests(text) {
  const body = text.replace(/^.*?\b(need to|have to|want to|must|should|plan to|goals? (are|is))\b/i, '');
  const clauses = body.split(/,|;|\band\b|\balso\b/i).map((s) => s.trim()).filter((s) => s.length > 2);
  const requests = [];
  for (const raw of clauses) {
    const c = raw.replace(/[.!?]/g, '').trim();
    const { minutes: totalMinutes, text: noDur } = extractDuration(c);
    const times = noDur.match(new RegExp(`\\b${NUM}\\s+times?\\b|\\b(once|twice)\\b`, 'i'));
    let sessions = times ? toNumber(times[1] || times[2]) : null;
    let rest = times ? noDur.replace(times[0], ' ') : noDur;
    const countNoun = rest.match(new RegExp(`\\b${NUM}\\s+([a-z]+)`, 'i'));
    if (!sessions && countNoun) {
      sessions = toNumber(countNoun[1]);
      rest = rest.replace(countNoun[0], ` ${countNoun[2].replace(/s$/, '')}`);
    }
    const category = detectCategory(c) || 'personal';
    let duration = DEFAULT_DURATION[category] || 60;
    if (totalMinutes && !sessions) {
      duration = Math.min(90, totalMinutes);
      sessions = Math.max(1, Math.round(totalMinutes / duration));
      duration = Math.round(totalMinutes / sessions);
    }
    if (/website|project/i.test(c) && category === 'freelancing') { duration = 120; sessions = (sessions || 1) * 2; }
    const title = cleanTitle(rest.replace(/\b(finish|complete|do|go to)\b/i, (m) => (/website|project/i.test(rest) ? 'Work on' : m)));
    if (!title) continue;
    requests.push({ title: normalizeTitle(title), category, sessions: Math.max(1, Math.min(14, Math.round(sessions || 1))), duration_minutes: duration });
  }
  return requests;
}

/**
 * @returns structured action: { intent, ...fields }
 */
function parse(text, { tz, prefs } = {}) {
  const raw = String(text).trim();
  const lower = raw.toLowerCase();

  if (/^(yes|yeah|yep|yup|sure|ok(ay)?|confirm|do it|sounds good|go ahead|please do|perfect|great|accept)\b[\s.!]*(please)?[\s.!]*$/i.test(raw)) return { intent: 'CONFIRM' };
  if (/^(no|nope|nah|cancel that|don'?t|never ?mind|not now|stop)\b[\s.!]*$/i.test(raw)) return { intent: 'REJECT' };

  if (/\bplan (my |the |this |next )?week\b|\bthis week i (need|have|want)\b|\bweekly plan\b|\bnext week i (need|have|want)\b/i.test(raw)) {
    const requests = /\b(need|have|want|must|should)\b/i.test(raw) ? parsePlanWeekRequests(raw) : [];
    return { intent: 'PLAN_WEEK', requests, week: /\bnext week\b/i.test(raw) ? 'next' : 'this' };
  }
  if (/\bplan (my |the )?(day|evening|morning|afternoon|tomorrow|today|tonight)\b|\bplan tomorrow\b|\borganize my day\b/i.test(raw)) {
    const when = parseWhen(raw, tz, prefs);
    return { intent: 'PLAN_DAY', date: when.date, time_of_day: timeOfDay(raw) };
  }
  if (/^(what|which|any|list|show|do i have|how many|are there)\b.*\balarms?\b|\balarms? do i have\b/i.test(raw)) {
    return { intent: 'QUERY_ALARMS', date: parseWhen(raw, tz, prefs).date };
  }
  if (/^(when should|when can|what'?s the best time|best time|good time)\b|\bwhen should i\b/i.test(raw)) {
    const { minutes, text: t1 } = extractDuration(raw);
    const when = parseWhen(t1, tz, prefs);
    const title = cleanTitle(t1.replace(/\b(when (should|can|could) i|what'?s the best time to|best time to|good time to|work on|do|be|go)\b/gi, ' '), when.matched);
    return { intent: 'SUGGEST_TIME', target: title, task_title: normalizeTitle(title), category: detectCategory(raw), duration_minutes: minutes, date: when.date, time_of_day: timeOfDay(raw) };
  }
  if (/^(what|what's|whats|show|list|how many|do i have|is there|anything)\b|\bmy (schedule|agenda|day|tasks)\b\??$|\bwhat'?s next\b/i.test(raw) && !/\b(add|remind me)\b/i.test(raw)) {
    const when = parseWhen(raw, tz, prefs);
    return { intent: 'QUERY_SCHEDULE', date: when.date, next: /\bnext\b/i.test(raw) };
  }

  if (/^(i )?(finished|completed|done with|did)\b|\bmark\b.*\b(done|complete|completed)\b/i.test(raw)) {
    const target = cleanTitle(raw.replace(/\b(i |finished|completed|done with|did|mark|as|done|complete)\b/gi, ' '));
    return { intent: 'COMPLETE_TASK', target };
  }

  if (/^(please )?(cancel|delete|remove|skip|clear)\b/i.test(raw)) {
    const when = parseWhen(raw, tz, prefs);
    const target = cleanTitle(raw.replace(/\b(cancel|delete|remove|skip|clear)\b/gi, ' '), when.matched);
    return { intent: 'CANCEL_TASK', target, date: when.date, is_alarm: /\balarm\b/i.test(raw), hard_delete: /\b(delete|remove)\b/i.test(raw) };
  }

  const cant = raw.match(/\b(i )?(can'?t|cannot|can not|won'?t be able to|unable to|not able to|couldn'?t|won'?t)\s+(do |make |go to |attend |make it to )?(my |the )?(.+?)(?:[.,;!]|$)/i);
  if (cant) {
    const rest = raw.slice(raw.indexOf(cant[0]) + cant[0].length);
    const firstWhen = parseWhen(cant[0], tz, prefs);
    const target = cleanTitle(cant[5], firstWhen.matched);
    const moveTo = rest.match(/\b(move|shift|push|reschedule|change)\b.*?\bto\b(.+)$/i) || rest.match(/\bto\b(.+)$/i);
    const newWhen = moveTo ? parseWhen(moveTo[moveTo.length - 1], tz, prefs) : null;
    return {
      intent: 'RESCHEDULE',
      target,
      date: firstWhen.date,
      time_of_day: timeOfDay(cant[0]),
      new_date: newWhen && newWhen.dayCertain ? newWhen.date : null,
      new_time: newWhen ? newWhen.time : null,
      new_time_of_day: moveTo ? timeOfDay(moveTo[moveTo.length - 1]) : null,
    };
  }

  if (/^(please )?(move|shift|push|reschedule|postpone|delay|change|bring forward)\b/i.test(raw)) {
    const idx = lower.lastIndexOf(' to ');
    const left = idx > 0 ? raw.slice(0, idx) : raw;
    const right = idx > 0 ? raw.slice(idx + 4) : '';
    const leftWhen = parseWhen(left, tz, prefs);
    const rightWhen = right ? parseWhen(right, tz, prefs) : { date: null, time: null };
    const target = cleanTitle(left.replace(/\b(move|shift|push|reschedule|postpone|delay|change|bring forward)\b/gi, ' ').replace(/\b(task|time)\b/gi, ' '), leftWhen.matched);
    const by = raw.match(new RegExp(`\\bby\\s+${NUM}\\s*(hours?|minutes?|mins?)`, 'i'));
    return {
      intent: 'UPDATE_TASK',
      target,
      date: leftWhen.dayCertain ? leftWhen.date : null,
      new_date: rightWhen.dayCertain ? rightWhen.date : null,
      new_time: rightWhen.time,
      new_time_of_day: timeOfDay(right),
      shift_minutes: by ? Math.round(toNumber(by[1]) * (/^h/i.test(by[2]) ? 60 : 1)) : null,
      postpone: /\b(postpone|delay|push back)\b/i.test(raw) && !rightWhen.time && !rightWhen.date,
    };
  }

  // Creation intents
  const isAlarm = /\b(alarm|wake me)\b/i.test(raw);
  const isReminder = /\bremind\b/i.test(raw);
  const { minutes: reminderMinutes, text: t1 } = extractReminder(raw);
  const { repeat, text: t2 } = extractRepeat(t1);
  const { minutes: duration, text: t3 } = extractDuration(t2);
  const when = parseWhen(t3, tz, prefs);
  let title = cleanTitle(t3, when.matched);
  if (!title && /wake me/i.test(raw)) title = 'Wake up';
  if (!title && isAlarm) title = 'Alarm';
  title = normalizeTitle(title);
  const category = detectCategory(raw);

  const looksLikeCreate = isAlarm || isReminder || /\b(add|schedule|create|book|put|plan to|i need to|i have to|new task)\b/i.test(raw) || when.time || when.date || repeat;
  if (!looksLikeCreate || !title) return { intent: 'UNKNOWN', text: raw };

  return {
    intent: isAlarm ? 'CREATE_ALARM' : isReminder ? 'CREATE_REMINDER' : 'CREATE_TASK',
    task_title: title,
    category,
    date: when.date,
    time: when.time,
    time_of_day: timeOfDay(raw),
    duration_minutes: duration,
    reminder_minutes: reminderMinutes,
    repeat,
  };
}

module.exports = { parse, detectCategory, extractDuration, extractRepeat, parsePlanWeekRequests, DEFAULT_DURATION, cleanTitle };
