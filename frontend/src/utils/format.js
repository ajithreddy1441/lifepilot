import { DateTime } from 'luxon';

let zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
export const setDisplayZone = (tz) => {
  if (tz) zone = tz;
};
export const getZone = () => zone;

export const dt = (iso) => (iso ? DateTime.fromISO(typeof iso === 'string' ? iso : new Date(iso).toISOString()).setZone(zone) : null);
export const now = () => DateTime.now().setZone(zone);
export const todayISO = () => now().toISODate();

export const fmtTime = (iso) => (iso ? dt(iso).toFormat('h:mm a') : '');
export const fmtTime24 = (iso) => (iso ? dt(iso).toFormat('HH:mm') : '');
export const fmtRange = (a, b) => (a ? `${fmtTime(a)}${b ? ` – ${fmtTime(b)}` : ''}` : 'Anytime');

export function fmtDay(iso) {
  if (!iso) return '';
  const d = dt(iso).startOf('day');
  const diff = Math.round(d.diff(now().startOf('day'), 'days').days);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  if (diff > 1 && diff < 7) return d.toFormat('cccc');
  return d.toFormat('ccc, d LLL');
}

export const fmtRelative = (iso) => (iso ? dt(iso).toRelative() : '');

export function greeting() {
  const h = now().hour;
  if (h < 12) return 'Good Morning';
  if (h < 17) return 'Good Afternoon';
  return 'Good Evening';
}

export const minutesLabel = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);

/** Local date + HH:mm in the user's zone -> ISO UTC string for the API */
export const toUtcIso = (date, time) => DateTime.fromISO(`${date}T${time}`, { zone }).toUTC().toISO();

export const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
export const dayShort = (d) => d[0] + d.slice(1).toLowerCase();

export const PRIORITY_STYLES = {
  low: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10 dark:text-emerald-300',
  medium: 'bg-amber-50 text-amber-600 dark:bg-amber-500/10 dark:text-amber-300',
  high: 'bg-rose-50 text-rose-600 dark:bg-rose-500/10 dark:text-rose-300',
  critical: 'bg-red-600 text-white',
};
