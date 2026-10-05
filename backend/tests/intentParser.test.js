const test = require('node:test');
const assert = require('node:assert');
const { parse } = require('../services/ai/intentParser');
const { parsedAction } = require('../services/ai/actionSchema');

const ctx = { tz: 'Asia/Kolkata', prefs: { wake_time: '06:30' } };
const p = (t) => parsedAction.parse(parse(t, ctx));

test('reminder with time and duration (main user flow)', () => {
  const a = p('Tomorrow at 6:40 AM remind me to workout for 40 minutes.');
  assert.strictEqual(a.intent, 'CREATE_REMINDER');
  assert.strictEqual(a.task_title, 'Workout');
  assert.strictEqual(a.time, '06:40');
  assert.strictEqual(a.duration_minutes, 40);
  assert.strictEqual(a.category, 'fitness');
});

test('alarm creation with repeat days and reminder offset', () => {
  const a = p('Workout Monday Wednesday Friday at 6:40 AM with alarm 10 minutes before');
  assert.strictEqual(a.intent, 'CREATE_ALARM');
  assert.deepStrictEqual(a.repeat.days, ['MON', 'WED', 'FRI']);
  assert.strictEqual(a.reminder_minutes, 10);
  assert.strictEqual(a.task_title, 'Workout');
});

test('"set an alarm for ..." is a creation, not a query', () => {
  assert.strictEqual(p('Set an alarm for 6:30 tomorrow morning.').intent, 'CREATE_ALARM');
  assert.strictEqual(p('What alarms do I have tomorrow?').intent, 'QUERY_ALARMS');
});

test('move / cancel / reschedule intents extract the target', () => {
  const move = p('Move my workout to 7 AM.');
  assert.strictEqual(move.intent, 'UPDATE_TASK');
  assert.strictEqual(move.target, 'Workout');
  assert.strictEqual(move.new_time, '07:00');

  const sat = p('Move my freelance task to Saturday.');
  assert.ok(sat.new_date);
  assert.strictEqual(sat.new_time, null);

  const cant = p("I can't workout tomorrow morning. Move it to 7 PM.");
  assert.strictEqual(cant.intent, 'RESCHEDULE');
  assert.strictEqual(cant.new_time, '19:00');

  assert.strictEqual(p('Cancel my workout tomorrow.').intent, 'CANCEL_TASK');
});

test('planning and suggestion intents', () => {
  assert.strictEqual(p('Plan my day tomorrow').intent, 'PLAN_DAY');
  assert.strictEqual(p('Plan my evening.').time_of_day, 'evening');
  assert.strictEqual(p('When should I work on my story?').intent, 'SUGGEST_TIME');
  const week = p('This week I need to finish two websites, workout four times, write one story, and study React for three hours.');
  assert.strictEqual(week.intent, 'PLAN_WEEK');
  const workout = week.requests.find((r) => r.title === 'Workout');
  assert.strictEqual(workout.sessions, 4);
  const react = week.requests.find((r) => /react/i.test(r.title));
  assert.strictEqual(react.sessions * react.duration_minutes, 180);
});

test('long block without a time keeps duration and time of day', () => {
  const a = p('Schedule five hours of freelance work tonight.');
  assert.strictEqual(a.intent, 'CREATE_TASK');
  assert.strictEqual(a.duration_minutes, 300);
  assert.strictEqual(a.time, null);
  assert.strictEqual(a.time_of_day, 'night');
});

test('confirmation words', () => {
  assert.strictEqual(p('Yes').intent, 'CONFIRM');
  assert.strictEqual(p('no').intent, 'REJECT');
});
