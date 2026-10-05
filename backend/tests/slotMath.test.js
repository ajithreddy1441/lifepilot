const test = require('node:test');
const assert = require('node:assert');
const M = require('../services/scheduler/slotMath');

const prefs = { wake_time: '06:30', sleep_time: '23:00', min_break_minutes: 10, max_focus_minutes: 90, preferred_workout_time: 'morning' };
const busy = [
  { s: 7 * 60 + 30, e: 8 * 60, type: 'block' }, // breakfast
  { s: 9 * 60 + 30, e: 18 * 60 + 30, type: 'work' },
  { s: 21 * 60, e: 21 * 60 + 30, type: 'block' }, // dinner
];

test('free time excludes work, meals, sleep and keeps a break buffer', () => {
  const free = M.freeIntervals(prefs, busy);
  assert.deepStrictEqual(free, [
    [400, 440], // 06:40-07:20
    [490, 560], // 08:10-09:20
    [1120, 1250], // 18:40-20:50
    [1300, 1380], // 21:40-23:00
  ]);
});

test('a morning workout lands at 06:40-07:20 (the spec example)', () => {
  const free = M.freeIntervals(prefs, busy);
  const [best] = M.candidates(prefs, free, { duration: 40, preferred: 'morning' });
  assert.strictEqual(M.minutesToTime(best.s), '06:40');
  assert.strictEqual(M.minutesToTime(best.e), '07:20');
  assert.ok(best.inPreferred);
});

test('job tasks are only placed inside work hours', () => {
  const free = M.freeIntervals(prefs, busy, { category: 'job' });
  assert.deepStrictEqual(free, [[570, 1110]]);
});

test('subtract and merge handle overlaps', () => {
  assert.deepStrictEqual(M.merge([[1, 5], [4, 8], [10, 12]]), [[1, 8], [10, 12]]);
  assert.deepStrictEqual(M.subtract([[0, 100]], [[10, 20], [15, 30], [90, 120]]), [[0, 10], [30, 90]]);
});

test('earliest cut-off removes past time today', () => {
  const free = M.freeIntervals(prefs, busy, { earliest: 19 * 60 });
  assert.deepStrictEqual(free[0], [1140, 1250]);
});
