const { DateTime, IANAZone } = require('luxon');

const DAY_CODES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

const isValidTimezone = (tz) => typeof tz === 'string' && IANAZone.isValidZone(tz);

/** 'HH:mm' or 'HH:mm:ss' -> minutes since midnight */
function timeToMinutes(t) {
  if (!t) return null;
  const [h, m] = String(t).split(':').map(Number);
  return h * 60 + (m || 0);
}

function minutesToTime(min) {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

const normTime = (t) => (t ? String(t).slice(0, 5) : null);

/** Wall-clock date + time in tz -> luxon DateTime (zone tz) */
function local(dateStr, timeStr, tz) {
  return DateTime.fromISO(`${dateStr}T${normTime(timeStr) || '00:00'}`, { zone: tz });
}

/** Wall-clock date + time in tz -> JS Date (UTC instant) */
const localToUtc = (dateStr, timeStr, tz) => local(dateStr, timeStr, tz).toUTC().toJSDate();

const inZone = (date, tz) => DateTime.fromJSDate(date instanceof Date ? date : new Date(date)).setZone(tz);

const todayIn = (tz) => DateTime.now().setZone(tz).toISODate();

function dayBoundsUtc(dateStr, tz) {
  const start = DateTime.fromISO(dateStr, { zone: tz }).startOf('day');
  return { start: start.toUTC().toJSDate(), end: start.plus({ days: 1 }).toUTC().toJSDate(), startLocal: start };
}

function weekStart(dateStr, tz) {
  return DateTime.fromISO(dateStr, { zone: tz }).startOf('week').toISODate(); // ISO week starts Monday
}

const dayCode = (dt) => DAY_CODES[dt.weekday - 1];

function parseDays(days) {
  if (!days) return [];
  const list = Array.isArray(days) ? days : String(days).split(',');
  return list.map((d) => String(d).trim().toUpperCase().slice(0, 3)).filter((d) => DAY_CODES.includes(d));
}

const formatDays = (days) => {
  const set = new Set(parseDays(days));
  return DAY_CODES.filter((d) => set.has(d)).join(',');
};

function humanTime(date, tz) {
  return inZone(date, tz).toFormat('h:mm a');
}

function humanDate(date, tz) {
  const dt = inZone(date, tz);
  const today = DateTime.now().setZone(tz).startOf('day');
  const diff = Math.round(dt.startOf('day').diff(today, 'days').days);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return dt.toFormat('cccc');
  return dt.toFormat('ccc, d LLL');
}

module.exports = {
  DateTime,
  DAY_CODES,
  isValidTimezone,
  timeToMinutes,
  minutesToTime,
  normTime,
  local,
  localToUtc,
  inZone,
  todayIn,
  dayBoundsUtc,
  weekStart,
  dayCode,
  parseDays,
  formatDays,
  humanTime,
  humanDate,
};
