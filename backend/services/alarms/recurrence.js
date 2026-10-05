const { DateTime } = require('luxon');
const { local, parseDays, dayCode, normTime } = require('../../utils/time');

const MAX_SCAN_DAYS = 800;

function matchesDay(alarm, d, startDate) {
  switch (alarm.repeat_type) {
    case 'daily':
      return true;
    case 'selected_days':
      return parseDays(alarm.repeat_days).includes(dayCode(d));
    case 'weekly': {
      const days = parseDays(alarm.repeat_days);
      return days.length ? days.includes(dayCode(d)) : d.weekday === startDate.weekday;
    }
    case 'custom': {
      const interval = Number(alarm.repeat_interval_days) || 1;
      const diff = Math.round(d.startOf('day').diff(startDate.startOf('day'), 'days').days);
      return diff >= 0 && diff % interval === 0;
    }
    default:
      return false;
  }
}

/**
 * Next trigger instant (JS Date, UTC) strictly after `after`, computed in the alarm's own timezone
 * so "06:40 every Monday" stays 06:40 local across DST changes.
 */
function nextOccurrence(alarm, after = new Date()) {
  const tz = alarm.timezone;
  const time = normTime(alarm.alarm_time);
  const afterDt = DateTime.fromJSDate(after).setZone(tz);
  const startDate = DateTime.fromISO(alarm.alarm_date, { zone: tz });
  const until = alarm.repeat_until ? DateTime.fromISO(alarm.repeat_until, { zone: tz }).endOf('day') : null;

  if (!alarm.repeat_type || alarm.repeat_type === 'once') {
    const t = local(alarm.alarm_date, time, tz);
    return t > afterDt ? t.toUTC().toJSDate() : null;
  }

  let d = startDate > afterDt.startOf('day') ? startDate : afterDt.startOf('day');
  for (let i = 0; i < MAX_SCAN_DAYS; i += 1, d = d.plus({ days: 1 })) {
    if (until && d > until) return null;
    if (!matchesDay(alarm, d, startDate)) continue;
    const t = local(d.toISODate(), time, tz);
    if (t > afterDt) return t.toUTC().toJSDate();
  }
  return null;
}

function upcomingOccurrences(alarm, count = 5, after = new Date()) {
  const out = [];
  let cursor = after;
  for (let i = 0; i < count; i += 1) {
    const next = nextOccurrence(alarm, cursor);
    if (!next) break;
    out.push(next);
    cursor = new Date(next.getTime() + 1000);
  }
  return out;
}

function describeRepeat(alarm) {
  const days = parseDays(alarm.repeat_days).map((d) => d[0] + d.slice(1).toLowerCase());
  switch (alarm.repeat_type) {
    case 'daily':
      return 'Every day';
    case 'selected_days':
      return days.length === 5 && !days.includes('Sat') && !days.includes('Sun') ? 'Weekdays' : days.join(' / ');
    case 'weekly':
      return `Weekly${days.length ? ` on ${days.join(', ')}` : ''}`;
    case 'custom':
      return `Every ${alarm.repeat_interval_days} days`;
    default:
      return 'Once';
  }
}

module.exports = { nextOccurrence, upcomingOccurrences, describeRepeat };
