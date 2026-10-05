const test = require('node:test');
const assert = require('node:assert');
const { nextOccurrence, upcomingOccurrences, describeRepeat } = require('../services/alarms/recurrence');

const iso = (d) => d && d.toISOString();

test('one-time alarm is interpreted in the alarm timezone, not the server timezone', () => {
  const a = { alarm_date: '2026-10-05', alarm_time: '06:40', timezone: 'Asia/Kolkata', repeat_type: 'once' };
  // 06:40 IST = 01:10 UTC
  assert.strictEqual(iso(nextOccurrence(a, new Date('2026-10-04T12:00:00Z'))), '2026-10-05T01:10:00.000Z');
  assert.strictEqual(nextOccurrence(a, new Date('2026-10-05T02:00:00Z')), null);
});

test('selected days (Mon/Wed/Fri) skips other days', () => {
  const a = { alarm_date: '2026-10-05', alarm_time: '06:40', timezone: 'Asia/Kolkata', repeat_type: 'selected_days', repeat_days: 'MON,WED,FRI' };
  const list = upcomingOccurrences(a, 4, new Date('2026-10-04T00:00:00Z')).map(iso);
  assert.deepStrictEqual(list, [
    '2026-10-05T01:10:00.000Z', // Mon
    '2026-10-07T01:10:00.000Z', // Wed
    '2026-10-09T01:10:00.000Z', // Fri
    '2026-10-12T01:10:00.000Z', // Mon
  ]);
  assert.strictEqual(describeRepeat(a), 'Mon / Wed / Fri');
});

test('daily alarm keeps local wall-clock time across a DST change', () => {
  const a = { alarm_date: '2026-03-07', alarm_time: '07:00', timezone: 'America/New_York', repeat_type: 'daily' };
  const [before, after] = [
    nextOccurrence(a, new Date('2026-03-07T00:00:00Z')),
    nextOccurrence(a, new Date('2026-03-09T00:00:00Z')),
  ];
  assert.strictEqual(iso(before), '2026-03-07T12:00:00.000Z'); // EST (UTC-5)
  assert.strictEqual(iso(after), '2026-03-09T11:00:00.000Z'); // EDT (UTC-4)
});

test('weekly defaults to the weekday of the start date; custom intervals count from start', () => {
  const weekly = { alarm_date: '2026-10-04', alarm_time: '20:00', timezone: 'Asia/Kolkata', repeat_type: 'weekly' };
  assert.strictEqual(iso(nextOccurrence(weekly, new Date('2026-10-04T15:00:00Z'))), '2026-10-11T14:30:00.000Z');
  const custom = { alarm_date: '2026-10-01', alarm_time: '09:00', timezone: 'UTC', repeat_type: 'custom', repeat_interval_days: 3 };
  assert.strictEqual(iso(nextOccurrence(custom, new Date('2026-10-02T00:00:00Z'))), '2026-10-04T09:00:00.000Z');
});

test('repeat_until stops recurrence', () => {
  const a = { alarm_date: '2026-10-01', alarm_time: '09:00', timezone: 'UTC', repeat_type: 'daily', repeat_until: '2026-10-02' };
  assert.strictEqual(upcomingOccurrences(a, 5, new Date('2026-09-30T00:00:00Z')).length, 2);
});
