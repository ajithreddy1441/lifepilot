// Pure interval math for a single day, in minutes from local midnight. No I/O, unit-tested.
const { timeToMinutes, minutesToTime } = require('../../utils/time');

const WINDOWS = {
  morning: [null, 12 * 60], // start = wake time
  afternoon: [12 * 60, 17 * 60],
  evening: [17 * 60, 21 * 60 + 30],
  night: [20 * 60, null], // end = sleep time
};

function dayBounds(prefs) {
  const wake = timeToMinutes(prefs.wake_time);
  let sleep = timeToMinutes(prefs.sleep_time);
  if (sleep <= wake) sleep += 1440;
  return { wake, sleep };
}

function windowFor(name, prefs) {
  const { wake, sleep } = dayBounds(prefs);
  const w = WINDOWS[name];
  if (!w) return null;
  return [w[0] ?? wake, Math.min(w[1] ?? sleep, sleep)];
}

function merge(intervals) {
  const sorted = intervals.filter(([s, e]) => e > s).sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const [s, e] of sorted) {
    if (out.length && s <= out[out.length - 1][1]) out[out.length - 1][1] = Math.max(out[out.length - 1][1], e);
    else out.push([s, e]);
  }
  return out;
}

function subtract(base, busy) {
  let free = base.map((x) => [...x]);
  for (const [bs, be] of merge(busy)) {
    const next = [];
    for (const [fs, fe] of free) {
      if (be <= fs || bs >= fe) next.push([fs, fe]);
      else {
        if (bs > fs) next.push([fs, bs]);
        if (be < fe) next.push([be, fe]);
      }
    }
    free = next;
  }
  return free.filter(([s, e]) => e > s);
}

const sum = (intervals) => intervals.reduce((t, [s, e]) => t + (e - s), 0);
const roundUp = (m, step = 5) => Math.ceil(m / step) * step;

/**
 * Free intervals for a day.
 * busy: [{s, e, type}] where type 'work' blocks are only free for job-category items.
 */
function freeIntervals(prefs, busy, { category, buffer = prefs.min_break_minutes ?? 10, earliest = 0 } = {}) {
  const { wake, sleep } = dayBounds(prefs);
  const isJob = category === 'job';
  const work = busy.filter((b) => b.type === 'work').map((b) => [b.s, b.e]);
  const others = busy.filter((b) => b.type !== 'work').map((b) => [b.s - buffer, b.e + buffer]);
  const base = isJob ? work : [[wake + buffer, sleep]];
  const blocked = isJob ? others : [...others, ...work.map(([s, e]) => [s - buffer, e + buffer])];
  const free = subtract(base, blocked);
  return earliest ? subtract(free, [[-1440, earliest]]) : free;
}

/** Score candidate starts. Higher is better. */
function candidates(prefs, free, { duration, preferred, anchor, earliest = 0 }) {
  const win = preferred ? windowFor(preferred, prefs) : null;
  const out = [];
  for (const [fs, fe] of free) {
    const starts = new Set([roundUp(Math.max(fs, earliest))]);
    if (win) starts.add(roundUp(Math.max(fs, win[0], earliest)));
    if (anchor !== null && anchor !== undefined) starts.add(roundUp(Math.max(anchor, fs, earliest)));
    for (let m = roundUp(Math.max(fs, earliest), 30); m < fe; m += 30) starts.add(m);
    for (const s of starts) {
      const e = s + duration;
      if (s < fs || e > fe) continue;
      let score = 100;
      if (win) {
        if (s >= win[0] && e <= win[1]) score += 50 - (s - win[0]) / 30;
        else score -= Math.min(Math.abs(s - win[0]), Math.abs(e - win[1])) / 6;
      } else {
        score -= (s - fs) / 60; // earlier in a free stretch keeps the rest of the stretch usable
      }
      if (anchor !== null && anchor !== undefined) {
        const d = Math.abs(s - anchor);
        score += d <= 30 ? 40 - d / 2 : -d / 8;
      }
      out.push({ s, e, score, inPreferred: !!win && s >= win[0] && e <= win[1] });
    }
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Pick up to n candidates that are meaningfully different (>= 60 min apart). */
function distinct(cands, n = 3) {
  const picked = [];
  for (const c of cands) {
    if (picked.every((p) => Math.abs(p.s - c.s) >= 60)) picked.push(c);
    if (picked.length >= n) break;
  }
  return picked;
}

function partOfDay(m) {
  const h = (m % 1440) / 60;
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  if (h < 21) return 'evening';
  return 'night';
}

module.exports = { WINDOWS, dayBounds, windowFor, merge, subtract, sum, roundUp, freeIntervals, candidates, distinct, partOfDay, minutesToTime };
